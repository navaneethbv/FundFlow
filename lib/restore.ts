import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RECEIPT_ASSETS_KEY,
  RECEIPT_ASSETS_OMITTED_KEY,
  USER_DATA_TABLES,
  type UserDataTableSpec,
} from "@/lib/user-data";

/**
 * The restore half of the backup system (features.md #5): turn a decrypted
 * archive (the exact payload `collectUserData` produced) into a validated,
 * per-table plan, then execute it all-or-nothing per table.
 *
 * Safety properties, in order of importance:
 * - Every write is user-scoped: deletes filter `user_id`, inserts stamp it.
 *   A restore can never touch another user's rows, regardless of payload.
 * - `transactions` is never delete-then-inserted. Rows carry their
 *   `plaid_transaction_id` (backups taken after this feature shipped do), so
 *   they upsert onto themselves and a restore followed by the next sync
 *   converges instead of duplicating. Rows from older archives without a
 *   plaid id get a `restored-<uuid>` provenance id and are counted as
 *   regenerated in the result.
 * - Only user-owned tables and the caller's profile preferences are restored.
 *   `shared_expenses` and `households` involve other people's rows; a restore
 *   reports them as skipped rather than deleting anyone else's data.
 * - Tables restore in foreign-key order (accounts before transactions, and so
 *   on); a failure in one table stops the run and is reported by name, never
 *   silently swallowed.
 * - `accounts` and `manual_accounts` are never delete-then-inserted either.
 *   Both are foreign-key parents, and `accounts` deletes cascade to the very
 *   transactions the restore is about to write, so a delete-first pass emptied
 *   the ledger before it could be refilled. They upsert onto their own natural
 *   key instead: `plaid_account_id` for Plaid accounts, `id` for manual ones.
 * - Receipt images travel as base64 in the `receipt_assets` section and are
 *   uploaded back into the `receipts` bucket, so a restore returns the pictures
 *   and not only their metadata rows.
 */

export class RestoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreValidationError";
  }
}

export interface RestorePlanTable {
  name: string;
  scope: UserDataTableSpec["scope"];
  rowCount: number;
  columns: string[];
}

export interface RestorePlan {
  tables: RestorePlanTable[];
  /** Archive sections that are not in the table registry (newer backup into an older deploy, or a tampered payload). */
  unknownKeys: string[];
  /** Registry tables absent from the archive (an older backup). */
  missingTables: string[];
  totalRows: number;
}

export function buildRestorePlan(
  archive: unknown,
  specs: readonly UserDataTableSpec[] = USER_DATA_TABLES,
): RestorePlan {
  if (!archive || typeof archive !== "object" || Array.isArray(archive)) {
    throw new RestoreValidationError("Backup payload is not an object");
  }
  const sections = archive as Record<string, unknown>;
  const specByKey = new Map(specs.map((spec) => [spec.key, spec]));

  const tables: RestorePlanTable[] = [];
  const unknownKeys: string[] = [];
  let totalRows = 0;

  for (const [key, value] of Object.entries(sections)) {
    // Backup-only sections carrying receipt imagery, not table rows. They are
    // restored alongside the `receipts` table, so they are neither a table in
    // the plan nor an unknown key.
    if (key === RECEIPT_ASSETS_KEY || key === RECEIPT_ASSETS_OMITTED_KEY) {
      continue;
    }
    const spec = specByKey.get(key);
    if (!spec) {
      unknownKeys.push(key);
      continue;
    }
    if (!Array.isArray(value)) {
      throw new RestoreValidationError(`Backup section "${key}" is not a row list`);
    }
    tables.push({
      name: key,
      scope: spec.scope,
      rowCount: value.length,
      columns: spec.select.split(",").map((column: string) => column.trim()),
    });
    totalRows += value.length;
  }

  const missingTables = specs
    .filter((spec) => !(spec.key in sections))
    .map((spec) => spec.key);

  return { tables, unknownKeys, missingTables, totalRows };
}

export interface RestoreResult {
  tables: Array<{ name: string; rowsWritten: number }>;
  skipped: Array<{ name: string; reason: string }>;
  failedTable: string | null;
  /** Rows given a fresh provenance id because the archive predates restore keys. */
  regeneratedIds: number;
  /** Receipt images written back into storage. */
  receiptAssetsRestored: number;
  /**
   * Receipt images the archive never carried (budget or a failed download at
   * backup time) plus any that failed to upload now. Reported so a restore
   * never implies a fidelity it did not deliver.
   */
  receiptAssetsMissing: number;
}

/** Cross-table foreign keys define the order; anything independent fits anywhere. */
const RESTORE_ORDER: readonly string[] = [
  "accounts",
  "manual_accounts",
  "user_tags",
  "securities",
  "budgets",
  "budget_templates",
  "goals",
  "merchant_rules",
  "category_overrides",
  "alert_preferences",
  "ai_settings",
  "account_preferences",
  "milestones",
  "advice_progress",
  "saved_reports",
  "sinking_funds",
  "net_worth_snapshots",
  "holdings",
  "holding_snapshots",
  "account_balance_snapshots",
  "recurring_streams",
  "recurring_stream_transactions",
  "transactions",
  "investment_transactions",
  "transaction_splits",
  "transaction_annotations",
  "goal_accounts",
  "goal_progress_events",
  "linked_refunds",
  "linked_duplicates",
  "linked_transfers",
  "scheduled_transactions",
  "account_reconciliations",
  "receipts",
];

const INSERT_CHUNK = 500;

type Row = Record<string, unknown>;

function stampRows(
  rows: readonly unknown[],
  userId: string,
): { rows: Row[]; regenerated: number } {
  let regenerated = 0;
  const stamped = rows.map((row) => {
    if (!row || typeof row !== "object") {
      regenerated += 1;
      return { user_id: userId, plaid_transaction_id: `restored-${randomUUID()}` };
    }
    const record = row as Row;
    if (record.plaid_transaction_id === undefined) {
      regenerated += 1;
      return {
        ...record,
        user_id: userId,
        plaid_transaction_id: `restored-${randomUUID()}`,
      };
    }
    return { ...record, user_id: userId };
  });
  return { rows: stamped, regenerated };
}

async function restoreTransactions(
  service: SupabaseClient,
  userId: string,
  rows: readonly unknown[],
): Promise<{ error: string | null; regenerated: number; rowsWritten: number }> {
  const { rows: stamped, regenerated } = stampRows(rows, userId);
  for (let index = 0; index < stamped.length; index += INSERT_CHUNK) {
    const { error } = await service
      .from("transactions")
      .upsert(stamped.slice(index, index + INSERT_CHUNK), {
        onConflict: "plaid_transaction_id",
      });
    if (error) {
      return { error: error.message, regenerated, rowsWritten: 0 };
    }
  }
  return { error: null, regenerated, rowsWritten: stamped.length };
}

/**
 * Upserts a foreign-key parent onto its natural key. Unlike
 * {@link restoreUserTable} this never deletes first: deleting `accounts` would
 * cascade the user's transactions away before the transactions section had a
 * chance to write them back.
 */
async function restoreParentTable(
  service: SupabaseClient,
  userId: string,
  name: string,
  rows: readonly unknown[],
  onConflict: string,
): Promise<{ error: string | null; rowsWritten: number }> {
  const stamped = rows.map((row) => ({
    ...(row && typeof row === "object" ? row : {}),
    user_id: userId,
  }));
  for (let index = 0; index < stamped.length; index += INSERT_CHUNK) {
    const { error } = await service
      .from(name)
      .upsert(stamped.slice(index, index + INSERT_CHUNK), { onConflict });
    if (error) {
      return { error: error.message, rowsWritten: 0 };
    }
  }
  return { error: null, rowsWritten: stamped.length };
}

/**
 * `accounts.plaid_item_id` is a NOT NULL foreign key into `plaid_items`, and
 * `plaid_items` is deliberately absent from the archive because it holds the
 * encrypted Plaid access token. An account whose item the user has since
 * unlinked therefore cannot be reinserted; it is reported rather than failing
 * the whole restore or being dropped in silence.
 */
async function splitRestorableAccounts(
  service: SupabaseClient,
  userId: string,
  rows: readonly unknown[],
): Promise<{ error: string | null; restorable: unknown[]; orphaned: number }> {
  const { data, error } = await service
    .from("plaid_items")
    .select("id")
    .eq("user_id", userId);
  if (error) {
    return { error: error.message, restorable: [], orphaned: 0 };
  }
  const itemIds = new Set((data ?? []).map((item) => (item as { id: string }).id));
  const restorable: unknown[] = [];
  let orphaned = 0;
  for (const row of rows) {
    const itemId = (row as { plaid_item_id?: unknown } | null)?.plaid_item_id;
    if (typeof itemId === "string" && itemIds.has(itemId)) {
      restorable.push(row);
    } else {
      orphaned += 1;
    }
  }
  return { error: null, restorable, orphaned };
}

const RECEIPT_BUCKET = "receipts";

/**
 * Writes the archived receipt images back into storage. Upload failures are
 * counted, never thrown: a missing photo must not abort a restore that has
 * already written the user's financial records.
 */
async function restoreReceiptAssets(
  service: SupabaseClient,
  assets: readonly unknown[],
): Promise<{ restored: number; failed: number }> {
  let restored = 0;
  let failed = 0;
  const bucket = service.storage.from(RECEIPT_BUCKET);
  for (const asset of assets) {
    const record = asset as
      | { storage_path?: unknown; content_type?: unknown; data_base64?: unknown }
      | null;
    if (
      typeof record?.storage_path !== "string" ||
      typeof record?.data_base64 !== "string"
    ) {
      failed += 1;
      continue;
    }
    try {
      const { error } = await bucket.upload(
        record.storage_path,
        Buffer.from(record.data_base64, "base64"),
        {
          contentType:
            typeof record.content_type === "string"
              ? record.content_type
              : "application/octet-stream",
          upsert: true,
        },
      );
      if (error) {
        failed += 1;
        continue;
      }
      restored += 1;
    } catch {
      failed += 1;
    }
  }
  return { restored, failed };
}

async function restoreUserTable(
  service: SupabaseClient,
  userId: string,
  name: string,
  rows: readonly unknown[],
): Promise<{ error: string | null; rowsWritten: number }> {
  const { error: deleteError } = await service
    .from(name)
    .delete()
    .eq("user_id", userId);
  if (deleteError) {
    return { error: deleteError.message, rowsWritten: 0 };
  }
  const stamped = rows.map((row) => ({
    ...(row && typeof row === "object" ? row : {}),
    user_id: userId,
  }));
  for (let index = 0; index < stamped.length; index += INSERT_CHUNK) {
    const { error } = await service
      .from(name)
      .insert(stamped.slice(index, index + INSERT_CHUNK));
    if (error) {
      return { error: error.message, rowsWritten: 0 };
    }
  }
  return { error: null, rowsWritten: stamped.length };
}

async function restoreProfilePreferences(
  service: SupabaseClient,
  userId: string,
  rows: readonly unknown[],
): Promise<{ error: string | null; rowsWritten: number }> {
  if (rows.length === 0) return { error: null, rowsWritten: 0 };
  if (rows.length > 1) {
    return { error: "profile preferences section contains multiple rows", rowsWritten: 0 };
  }
  const record = rows[0];
  if (!record || typeof record !== "object") {
    return { error: "profile preferences row is invalid", rowsWritten: 0 };
  }
  const dashboardPrefs = (record as Record<string, unknown>).dashboard_prefs;
  if (
    dashboardPrefs !== null &&
    (typeof dashboardPrefs !== "object" || Array.isArray(dashboardPrefs))
  ) {
    return { error: "profile preferences payload is invalid", rowsWritten: 0 };
  }
  const { error } = await service
    .from("profiles")
    .update({ dashboard_prefs: dashboardPrefs ?? {} })
    .eq("id", userId);
  return error
    ? { error: error.message, rowsWritten: 0 }
    : { error: null, rowsWritten: 1 };
}

export async function executeRestore(
  service: SupabaseClient,
  userId: string,
  plan: RestorePlan,
  archive: Record<string, unknown[]>,
): Promise<RestoreResult> {
  const result: RestoreResult = {
    tables: [],
    skipped: [],
    failedTable: null,
    regeneratedIds: 0,
    receiptAssetsRestored: 0,
    receiptAssetsMissing: (archive[RECEIPT_ASSETS_OMITTED_KEY] ?? []).length,
  };

  const present = new Map(plan.tables.map((entry) => [entry.name, entry]));
  const ordered = [
    ...RESTORE_ORDER.filter((name) => present.has(name)),
    ...plan.tables.map((entry) => entry.name).filter((name) => !RESTORE_ORDER.includes(name)),
  ];

  for (const name of ordered) {
    const entry = present.get(name)!;
    if (entry.scope === "profile") {
      const outcome = await restoreProfilePreferences(service, userId, archive[name] ?? []);
      if (outcome.error) {
        result.failedTable = name;
        return result;
      }
      result.tables.push({ name, rowsWritten: outcome.rowsWritten });
      continue;
    }
    if (entry.scope !== "user") {
      result.skipped.push({
        name,
        reason: "involves other users' rows; not restorable in-app",
      });
      continue;
    }
    const rows = archive[name] ?? [];
    if (name === "accounts") {
      const split = await splitRestorableAccounts(service, userId, rows);
      if (split.error) {
        result.failedTable = name;
        return result;
      }
      if (split.orphaned > 0) {
        result.skipped.push({
          name: "accounts (unlinked banks)",
          reason:
            split.orphaned === 1
              ? "1 account belongs to a Plaid connection this account no longer has; relink the bank, then restore again"
              : `${split.orphaned} accounts belong to a Plaid connection this account no longer has; relink the bank, then restore again`,
        });
      }
      const outcome = await restoreParentTable(
        service,
        userId,
        name,
        split.restorable,
        "plaid_account_id",
      );
      if (outcome.error) {
        result.failedTable = name;
        return result;
      }
      result.tables.push({ name, rowsWritten: outcome.rowsWritten });
      continue;
    }
    if (name === "manual_accounts") {
      const outcome = await restoreParentTable(service, userId, name, rows, "id");
      if (outcome.error) {
        result.failedTable = name;
        return result;
      }
      result.tables.push({ name, rowsWritten: outcome.rowsWritten });
      continue;
    }
    if (name === "transactions") {
      const outcome = await restoreTransactions(service, userId, rows);
      result.regeneratedIds += outcome.regenerated;
      if (outcome.error) {
        result.failedTable = name;
        return result;
      }
      result.tables.push({ name, rowsWritten: outcome.rowsWritten });
      continue;
    }

    const outcome = await restoreUserTable(service, userId, name, rows);
    if (outcome.error) {
      result.failedTable = name;
      return result;
    }
    result.tables.push({ name, rowsWritten: outcome.rowsWritten });
  }

  const receiptAssets = archive[RECEIPT_ASSETS_KEY] ?? [];
  if (receiptAssets.length > 0) {
    const outcome = await restoreReceiptAssets(service, receiptAssets);
    result.receiptAssetsRestored = outcome.restored;
    result.receiptAssetsMissing += outcome.failed;
  }

  return result;
}
