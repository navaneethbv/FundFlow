import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { USER_DATA_TABLES, type UserDataTableSpec } from "@/lib/user-data";

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
 * - Only "user"-scope tables are restored. `shared_expenses` and `households`
 *   involve other people's rows; a restore reports them as skipped rather
 *   than deleting anyone else's data.
 * - Tables restore in foreign-key order (accounts before transactions, and so
 *   on); a failure in one table stops the run and is reported by name, never
 *   silently swallowed.
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
  };

  const present = new Map(plan.tables.map((entry) => [entry.name, entry]));
  const ordered = [
    ...RESTORE_ORDER.filter((name) => present.has(name)),
    ...plan.tables.map((entry) => entry.name).filter((name) => !RESTORE_ORDER.includes(name)),
  ];

  for (const name of ordered) {
    const entry = present.get(name)!;
    if (entry.scope !== "user") {
      result.skipped.push({
        name,
        reason: "involves other users' rows; not restorable in-app",
      });
      continue;
    }
    if (entry.rowCount === 0) continue;

    const rows = archive[name] ?? [];
    if (name === "transactions") {
      const { rows: stamped, regenerated } = stampRows(rows, userId);
      result.regeneratedIds += regenerated;
      for (let index = 0; index < stamped.length; index += INSERT_CHUNK) {
        const { error } = await service
          .from("transactions")
          .upsert(stamped.slice(index, index + INSERT_CHUNK), {
            onConflict: "plaid_transaction_id",
          });
        if (error) {
          result.failedTable = name;
          return result;
        }
      }
      result.tables.push({ name, rowsWritten: stamped.length });
      continue;
    }

    const { error: deleteError } = await service
      .from(name)
      .delete()
      .eq("user_id", userId);
    if (deleteError) {
      result.failedTable = name;
      return result;
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
        result.failedTable = name;
        return result;
      }
    }
    result.tables.push({ name, rowsWritten: stamped.length });
  }

  return result;
}
