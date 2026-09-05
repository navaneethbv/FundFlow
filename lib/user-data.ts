import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/feature-flags";

/**
 * One source of truth for the user-owned tables a full takeout/backup carries.
 *
 * Both `app/api/export/takeout/route.ts` and `app/api/cron/backup/route.ts`
 * build their archive from the rows collected here, so a table added to a
 * user's takeout is automatically added to the encrypted backup (and vice
 * versa) — the sibling-checklist drift this module was written to prevent.
 *
 * Every row must be scoped to the owning user (or, for the two household
 * tables, to the caller's involvement/ownership). The `scope` field encodes
 * which filter each table needs:
 *   - "user":   .eq("user_id", userId)
 *   - "shared": .or(paid_by/owed_user_id match) — no user_id column
 *   - "owner":  .eq("owner_user_id", userId)
 *   - "profile": .eq("id", userId) on the caller's profile row
 *
 * Investment tables are feature-gated: before the investments migration is
 * applied they don't exist, so they must not be queried unconditionally.
 */
type TableScope = "user" | "shared" | "owner" | "profile";

export interface UserDataTableSpec {
  key: string;
  table: string;
  select: string;
  scope: TableScope;
  gated?: boolean;
  /**
   * Extra columns only the encrypted BACKUP carries (never the takeout, whose
   * contract excludes identifiers): the natural keys a restore needs to
   * converge with Plaid sync and satisfy cross-table foreign keys.
   */
  restoreKeys?: string;
  /** Deterministic sorting column for paginated chunk queries. */
  orderBy?: string;
  /** Optional unique tie-breaker. Null means orderBy is already unique. */
  orderBySecondary?: string | null;
}

/**
 * Everything past the archive key and its column list, as one named bag. The
 * positional form had grown to eight arguments, most of them defaulted, so a
 * call site was a row of bare `false`/`undefined` placeholders whose meaning
 * you had to count out against the signature.
 */
interface TableOptions {
  scope?: TableScope;
  gated?: boolean;
  restoreKeys?: string;
  orderBy?: string;
  /** Physical table name, when it differs from the archive key. */
  tableName?: string;
  orderBySecondary?: string | null;
}

function table(key: string, select: string, options: TableOptions = {}): UserDataTableSpec {
  const {
    scope = "user",
    gated = false,
    restoreKeys,
    orderBy,
    tableName = key,
    orderBySecondary = "id",
  } = options;
  return {
    key,
    table: tableName,
    select,
    scope,
    ...(gated ? { gated: true } : {}),
    ...(restoreKeys ? { restoreKeys } : {}),
    orderBy: orderBy ?? (select.includes("created_at") ? "created_at" : "id"),
    orderBySecondary,
  };
}

/** Exported for the restore planner (lib/restore.ts) - same list, same drift guard. */
export const USER_DATA_TABLES: UserDataTableSpec[] = [
  table("accounts", "name, official_name, mask, type, subtype, current_balance, available_balance, credit_limit, iso_currency_code", { restoreKeys: "id, plaid_account_id, plaid_item_id" }),
  table("transactions", "date, amount, iso_currency_code, name, merchant_name, pfc_primary, pfc_detailed, pending", { restoreKeys: "id, plaid_transaction_id, account_id, manual_account_id, source" }),
  table("budgets", "category, monthly_limit, rollover_enabled", { restoreKeys: "id" }),
  table("goals", "name, target_amount, saved_amount, target_date, goal_type", { restoreKeys: "id" }),
  table("merchant_rules", "match_type, pattern, display_name, category, enabled, tags, amount_operator, amount_value, amount_max_value"),
  table("manual_accounts", "name, account_type, balance, include_in_net_worth", { restoreKeys: "id" }),
  table("account_balance_snapshots", "account_id, manual_account_id, snapshot_date, current_balance, available_balance, iso_currency_code, captured_at", { orderBy: "captured_at" }),
  table("alert_preferences", "broken_bank, budget_exceeded, goal_reached, large_transaction, low_cash_forecast", { orderBy: "user_id", orderBySecondary: null }),
  table("ai_settings", "enabled", { orderBy: "user_id", orderBySecondary: null }),
  table("budget_periods", "budget_id, month, planned"),
  table("saved_reports", "name, report_type, filters, created_at, updated_at"),
  table("holdings", "account_id, manual_account_id, quantity, cost_basis, institution_price, institution_value, as_of, source, is_active", { gated: true }),
  table("holding_snapshots", "holding_id, snapshot_date, quantity, price, value", { gated: true }),
  table("securities", "name, ticker, security_type, security_subtype, close_price, close_price_as_of, iso_currency_code", { gated: true }),
  table("investment_transactions", "date, name, amount, quantity, price, fees, txn_type, txn_subtype, iso_currency_code", { gated: true }),
  table("transaction_splits", "transaction_id, category, amount, created_at"),
  table("transaction_annotations", "transaction_id, note, tags, display_category, cash_flow_classification, cleared_at, created_at, updated_at"),
  table("linked_refunds", "charge_transaction_id, refund_transaction_id, amount, created_at"),
  table("linked_duplicates", "subject_id, kept_transaction_id, excluded_transaction_id, created_at"),
  table("receipts", "transaction_id, storage_path, merchant, purchase_date, total, status, created_at", { restoreKeys: "id" }),
  table("user_tags", "name, color_slot, created_at"),
  table("sinking_funds", "name, target_amount, due_date, created_at"),
  table("scheduled_transactions", "kind, amount, merchant, scheduled_date, category, notes, account_id, manual_account_id, status, created_at"),
  table("recurring_streams", "stream_type, description, merchant_name, average_amount, last_amount, frequency, status, category, is_active, first_date, last_date, predicted_next_date, user_amount, created_at", { restoreKeys: "id" }),
  table("recurring_stream_transactions", "recurring_stream_id, transaction_id, created_at"),
  table("milestones", "key, title, created_at"),
  table("goal_accounts", "goal_id, account_id, allocated_amount, use_entire_balance, created_at"),
  table("goal_progress_events", "goal_id, event_date, amount, event_type, created_at"),
  table("advice_progress", "advice_id, task_id, content_version, completed_at", { orderBy: "completed_at" }),
  table("category_overrides", "source_category, display_category, created_at"),
  table("shared_expenses", "description, amount, paid_by, owed_user_id, settled_at, created_at", { scope: "shared" }),
  table("net_worth_snapshots", "snapshot_month, assets, liabilities, created_at"),
  table("households", "name, created_at, updated_at", { scope: "owner" }),
  table("budget_templates", "name, items, created_at"),
  table("linked_transfers", "out_transaction_id, in_transaction_id, amount, created_at"),
  table("account_reconciliations", "account_id, manual_account_id, statement_date, statement_balance, created_at"),
  table("account_preferences", "dashboard_prefs", { scope: "profile", restoreKeys: "id", orderBy: "id", tableName: "profiles" }),
  table("credit_card_bills", "account_id, statement_balance, minimum_payment, due_date, payment_account_id, sync_timestamp, created_at, updated_at", { restoreKeys: "id" }),
  table("life_events", "event_type, start_month, amount, duration_months, label, created_at, updated_at", { restoreKeys: "id" }),
];

interface ScopedQueryBuilder {
  eq(column: string, value: string): ScopedQueryBuilder;
  or(filters: string): ScopedQueryBuilder;
  order(column: string, options: { ascending: boolean }): ScopedQueryBuilder;
  range(from: number, to: number): PromiseLike<{ data?: unknown; error?: unknown }>;
}

function applySpecScope(
  builder: ScopedQueryBuilder,
  scope: UserDataTableSpec["scope"],
  userId: string,
): ScopedQueryBuilder {
  if (scope === "user") {
    return builder.eq("user_id", userId);
  }
  if (scope === "owner") {
    return builder.eq("owner_user_id", userId);
  }
  if (scope === "profile") {
    return builder.eq("id", userId);
  }
  return builder.or(`paid_by.eq.${userId},owed_user_id.eq.${userId}`);
}

async function fetchPagedSpecRows(
  client: Pick<SupabaseClient, "from">,
  spec: UserDataTableSpec,
  userId: string,
  options: { includeRestoreKeys?: boolean },
): Promise<{ data: unknown[]; error: unknown }> {
  const PAGE_SIZE = 1000;
  const select =
    options.includeRestoreKeys && spec.restoreKeys
      ? spec.select + ", " + spec.restoreKeys
      : spec.select;

  const rows: unknown[] = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const builder = client.from(spec.table).select(select) as unknown as ScopedQueryBuilder;
    const scoped = applySpecScope(builder, spec.scope, userId);
    const primaryOrder = spec.orderBy ?? "id";
    const ordered = scoped.order(primaryOrder, { ascending: true });
    const stableOrder = spec.orderBySecondary === null
      ? ordered
      : ordered.order(spec.orderBySecondary ?? "id", { ascending: true });
    const result = await stableOrder.range(from, to);
    if (result?.error) return { data: [], error: result.error };
    const batch = (result?.data ?? []) as unknown[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

/**
 * Fetch every user-owned section in parallel, keyed by archive section name.
 * Uses deterministic pagination (1,000 rows/page) so large tables are not truncated.
 * Throws on the first failing query; null data is coerced to empty arrays so
 * callers can spread the result straight into a payload.
 */
export async function collectUserData(
  client: Pick<SupabaseClient, "from">,
  userId: string,
  options: { includeRestoreKeys?: boolean } = {},
): Promise<Record<string, unknown[]>> {
  const investmentsEnabled = isFeatureEnabled("investmentsPage");

  const queries = USER_DATA_TABLES.map((spec) => {
    if (spec.gated && !investmentsEnabled) {
      return Promise.resolve({ data: [], error: null });
    }
    return fetchPagedSpecRows(client, spec, userId, options);
  });

  const results = await Promise.all(queries);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;

  const sections: Record<string, unknown[]> = {};
  USER_DATA_TABLES.forEach((spec, index) => {
    sections[spec.key] = results[index].data;
  });
  return sections;
}

/** Total row count across every collected section. */
export function countUserDataRows(sections: Record<string, unknown[]>): number {
  return Object.values(sections).reduce(
    (total, rows) => total + rows.length,
    0,
  );
}

/**
 * Sections that hold settings rather than records. A row appears in these the
 * moment someone flips a single toggle, so counting them would make an account
 * that has never linked a bank or entered a transaction look worth backing up.
 */
const PREFERENCE_SECTION_KEYS = new Set([
  "account_preferences",
  "alert_preferences",
  "ai_settings",
]);

/**
 * Row count across the sections that represent actual financial records. The
 * monthly backup uses this to decide whether a user has anything to archive;
 * {@link countUserDataRows} still reports everything the archive contains.
 */
export function countUserRecordRows(
  sections: Record<string, unknown[]>,
): number {
  return Object.entries(sections).reduce(
    (total, [key, rows]) =>
      PREFERENCE_SECTION_KEYS.has(key) ? total : total + rows.length,
    0,
  );
}

/**
 * Section key holding the receipt image bytes, and the companion key naming
 * every image the archive could not carry. Both are backup-only: the takeout
 * contract is date/merchant/amount/category, and a receipt photo is none of
 * those.
 */
export const RECEIPT_ASSETS_KEY = "receipt_assets";
export const RECEIPT_ASSETS_OMITTED_KEY = "receipt_assets_omitted";

/**
 * How many bytes of receipt imagery one archive may carry, before gzip and
 * encryption. The archive is delivered as an email attachment, and mail
 * providers reject well before this figure doubles, so the budget stops a
 * photo-heavy account from producing a backup that can never be delivered.
 */
export const RECEIPT_ASSET_BUDGET_BYTES = 8 * 1024 * 1024;

export interface ReceiptAsset {
  storage_path: string;
  content_type: string;
  /** Base64 image bytes; JSON has no binary type. */
  data_base64: string;
}

export interface OmittedReceiptAsset {
  storage_path: string;
  reason: "budget_exceeded" | "download_failed";
}

interface StorageBucketLike {
  download(path: string): Promise<{ data?: Blob | null; error?: unknown }>;
}

interface StorageClientLike {
  storage: { from(bucket: string): StorageBucketLike };
}

/**
 * Downloads the receipt images referenced by the already-collected `receipts`
 * rows so a restore can put the pictures back, not just the metadata.
 *
 * Completeness is reported, never assumed: anything the budget or a failed
 * download leaves out comes back in `omitted`, and the archive carries that
 * list beside the bytes. A backup that quietly dropped images would claim a
 * fidelity it does not have.
 */
export async function collectReceiptAssets(
  client: StorageClientLike,
  receiptRows: readonly unknown[],
  budgetBytes: number = RECEIPT_ASSET_BUDGET_BYTES,
): Promise<{ assets: ReceiptAsset[]; omitted: OmittedReceiptAsset[] }> {
  const bucket = client.storage.from("receipts");
  const assets: ReceiptAsset[] = [];
  const omitted: OmittedReceiptAsset[] = [];
  let usedBytes = 0;

  const paths = receiptRows
    .map((row) => (row as { storage_path?: unknown } | null)?.storage_path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);

  for (const storagePath of paths) {
    if (usedBytes >= budgetBytes) {
      omitted.push({ storage_path: storagePath, reason: "budget_exceeded" });
      continue;
    }
    let blob: Blob | null | undefined;
    try {
      const result = await bucket.download(storagePath);
      if (result?.error) throw result.error;
      blob = result?.data;
    } catch {
      omitted.push({ storage_path: storagePath, reason: "download_failed" });
      continue;
    }
    if (!blob) {
      omitted.push({ storage_path: storagePath, reason: "download_failed" });
      continue;
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (usedBytes + bytes.byteLength > budgetBytes) {
      omitted.push({ storage_path: storagePath, reason: "budget_exceeded" });
      continue;
    }
    usedBytes += bytes.byteLength;
    assets.push({
      storage_path: storagePath,
      content_type: blob.type || "application/octet-stream",
      data_base64: bytes.toString("base64"),
    });
  }

  return { assets, omitted };
}
