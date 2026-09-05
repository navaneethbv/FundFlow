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
 *
 * Investment tables are feature-gated: before the investments migration is
 * applied they don't exist, so they must not be queried unconditionally.
 */
type TableScope = "user" | "shared" | "owner";

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
}

function table(
  key: string,
  select: string,
  scope: TableScope = "user",
  gated = false,
  restoreKeys?: string,
): UserDataTableSpec {
  return {
    key,
    table: key,
    select,
    scope,
    ...(gated ? { gated: true } : {}),
    ...(restoreKeys ? { restoreKeys } : {}),
  };
}

/** Exported for the restore planner (lib/restore.ts) - same list, same drift guard. */
export const USER_DATA_TABLES: UserDataTableSpec[] = [
  table("accounts", "name, official_name, mask, type, subtype, current_balance, available_balance, credit_limit, iso_currency_code", "user", false, "id"),
  table("transactions", "date, amount, iso_currency_code, name, merchant_name, pfc_primary, pfc_detailed, pending", "user", false, "id, plaid_transaction_id, account_id, manual_account_id, source"),
  table("budgets", "category, monthly_limit, rollover_enabled", "user", false, "id"),
  table("goals", "name, target_amount, saved_amount, target_date, goal_type", "user", false, "id"),
  table("merchant_rules", "match_type, pattern, display_name, category, enabled, tags, amount_operator, amount_value, amount_max_value"),
  table("manual_accounts", "name, account_type, balance, include_in_net_worth", "user", false, "id"),
  table("account_balance_snapshots", "account_id, manual_account_id, snapshot_date, current_balance, available_balance, iso_currency_code, captured_at"),
  table("alert_preferences", "broken_bank, budget_exceeded, goal_reached, large_transaction, low_cash_forecast"),
  table("ai_settings", "enabled"),
  table("budget_periods", "budget_id, month, planned"),
  table("saved_reports", "name, report_type, filters, created_at, updated_at"),
  table("holdings", "account_id, manual_account_id, quantity, cost_basis, institution_price, institution_value, as_of, source, is_active", "user", true),
  table("holding_snapshots", "holding_id, snapshot_date, quantity, price, value", "user", true),
  table("securities", "name, ticker, security_type, security_subtype, close_price, close_price_as_of, iso_currency_code", "user", true),
  table("investment_transactions", "date, name, amount, quantity, price, fees, txn_type, txn_subtype, iso_currency_code", "user", true),
  table("transaction_splits", "transaction_id, category, amount, created_at"),
  table("transaction_annotations", "transaction_id, note, tags, created_at, updated_at"),
  table("linked_refunds", "charge_transaction_id, refund_transaction_id, amount, created_at"),
  table("linked_duplicates", "subject_id, kept_transaction_id, excluded_transaction_id, created_at"),
  table("receipts", "transaction_id, storage_path, merchant, purchase_date, total, status, created_at"),
  table("user_tags", "name, color_slot, created_at"),
  table("sinking_funds", "name, target_amount, due_date, created_at"),
  table("scheduled_transactions", "kind, amount, merchant, scheduled_date, category, notes, account_id, manual_account_id, status, created_at"),
  table("recurring_streams", "stream_type, description, merchant_name, average_amount, last_amount, frequency, status, category, is_active, first_date, last_date, predicted_next_date, user_amount, created_at", "user", false, "id"),
  table("recurring_stream_transactions", "recurring_stream_id, transaction_id, created_at"),
  table("milestones", "key, title, created_at"),
  table("goal_accounts", "goal_id, account_id, allocated_amount, use_entire_balance, created_at"),
  table("goal_progress_events", "goal_id, event_date, amount, event_type, created_at"),
  table("advice_progress", "advice_id, task_id, content_version, completed_at"),
  table("category_overrides", "source_category, display_category, created_at"),
  table("shared_expenses", "description, amount, paid_by, owed_user_id, settled_at, created_at", "shared"),
  table("net_worth_snapshots", "snapshot_month, assets, liabilities, created_at"),
  table("households", "name, created_at, updated_at", "owner"),
  table("budget_templates", "name, items, created_at"),
  table("linked_transfers", "out_transaction_id, in_transaction_id, amount, created_at"),
  table("account_reconciliations", "account_id, manual_account_id, statement_date, statement_balance, created_at"),
  table("account_preferences", "account_id, manual_account_id, is_hidden, include_in_net_worth, custom_name, display_order", "user"),
  table("credit_card_bills", "account_id, balance, minimum_payment, due_date, apr", "user"),
  table("life_events", "event_type, target_date, target_amount, notes", "user"),
];

function applySpecScope(
  builder: {
    eq: (column: string, value: string) => unknown;
    or: (filters: string) => unknown;
  },
  scope: UserDataTableSpec["scope"],
  userId: string,
) {
  if (scope === "user") {
    return builder.eq("user_id", userId);
  }
  if (scope === "owner") {
    return builder.eq("owner_user_id", userId);
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
    const builder = client.from(spec.table).select(select);
    const query = applySpecScope(builder, spec.scope, userId) as unknown as {
      range?: (from: number, to: number) => PromiseLike<{ data?: unknown; error?: unknown }>;
    } & PromiseLike<{ data?: unknown; error?: unknown }>;

    const result =
      typeof query?.range === "function"
        ? await query.range(from, to)
        : await query;
    if (result?.error) return { data: [], error: result.error };
    const batch = (result?.data ?? []) as unknown[];
    rows.push(...batch);
    if (typeof query?.range !== "function" || batch.length < PAGE_SIZE) break;
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
const PREFERENCE_SECTION_KEYS = new Set(["alert_preferences", "ai_settings"]);

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
