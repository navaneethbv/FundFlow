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

interface UserDataTableSpec {
  key: string;
  table: string;
  select: string;
  scope: TableScope;
  gated?: boolean;
}

const USER_DATA_TABLES: UserDataTableSpec[] = [
  {
    key: "accounts",
    table: "accounts",
    select:
      "name, official_name, mask, type, subtype, current_balance, available_balance, credit_limit, iso_currency_code",
    scope: "user",
  },
  {
    key: "transactions",
    table: "transactions",
    select:
      "date, amount, iso_currency_code, name, merchant_name, pfc_primary, pfc_detailed, pending",
    scope: "user",
  },
  {
    key: "budgets",
    table: "budgets",
    select: "category, monthly_limit, rollover_enabled",
    scope: "user",
  },
  {
    key: "goals",
    table: "goals",
    select: "name, target_amount, saved_amount, target_date, goal_type",
    scope: "user",
  },
  {
    key: "merchant_rules",
    table: "merchant_rules",
    select: "match_type, pattern, display_name, category, enabled",
    scope: "user",
  },
  {
    key: "manual_accounts",
    table: "manual_accounts",
    select: "name, account_type, balance, include_in_net_worth",
    scope: "user",
  },
  {
    key: "account_balance_snapshots",
    table: "account_balance_snapshots",
    select:
      "account_id, manual_account_id, snapshot_date, current_balance, available_balance, iso_currency_code",
    scope: "user",
  },
  {
    key: "alert_preferences",
    table: "alert_preferences",
    select: "broken_bank, budget_exceeded, goal_reached, large_transaction, low_cash_forecast",
    scope: "user",
  },
  {
    key: "ai_settings",
    table: "ai_settings",
    select: "enabled",
    scope: "user",
  },
  {
    key: "budget_periods",
    table: "budget_periods",
    select: "budget_id, month, planned",
    scope: "user",
  },
  {
    key: "saved_reports",
    table: "saved_reports",
    select: "name, report_type, filters, created_at, updated_at",
    scope: "user",
  },
  {
    key: "holdings",
    table: "holdings",
    select:
      "account_id, manual_account_id, quantity, cost_basis, institution_price, institution_value, as_of, source, is_active",
    scope: "user",
    gated: true,
  },
  {
    key: "holding_snapshots",
    table: "holding_snapshots",
    select: "holding_id, snapshot_date, quantity, price, value",
    scope: "user",
    gated: true,
  },
  {
    key: "securities",
    table: "securities",
    select:
      "name, ticker, security_type, security_subtype, close_price, close_price_as_of, iso_currency_code",
    scope: "user",
    gated: true,
  },
  {
    key: "investment_transactions",
    table: "investment_transactions",
    select:
      "date, name, amount, quantity, price, fees, txn_type, txn_subtype, iso_currency_code",
    scope: "user",
    gated: true,
  },
  {
    key: "transaction_splits",
    table: "transaction_splits",
    select: "transaction_id, category, amount, created_at",
    scope: "user",
  },
  {
    key: "transaction_annotations",
    table: "transaction_annotations",
    select: "transaction_id, note, tags, created_at, updated_at",
    scope: "user",
  },
  {
    key: "linked_refunds",
    table: "linked_refunds",
    select: "charge_transaction_id, refund_transaction_id, amount, created_at",
    scope: "user",
  },
  {
    key: "linked_duplicates",
    table: "linked_duplicates",
    select: "subject_id, kept_transaction_id, excluded_transaction_id, created_at",
    scope: "user",
  },
  {
    key: "receipts",
    table: "receipts",
    select: "transaction_id, storage_path, merchant, purchase_date, total, status, created_at",
    scope: "user",
  },
  {
    key: "user_tags",
    table: "user_tags",
    select: "name, color_slot, created_at",
    scope: "user",
  },
  {
    key: "sinking_funds",
    table: "sinking_funds",
    select: "name, target_amount, due_date, created_at",
    scope: "user",
  },
  {
    key: "recurring_streams",
    table: "recurring_streams",
    select:
      "stream_type, description, merchant_name, average_amount, last_amount, frequency, status, category, is_active, first_date, last_date, predicted_next_date, user_amount, created_at",
    scope: "user",
  },
  {
    key: "recurring_stream_transactions",
    table: "recurring_stream_transactions",
    select: "recurring_stream_id, transaction_id, created_at",
    scope: "user",
  },
  {
    key: "milestones",
    table: "milestones",
    select: "key, title, created_at",
    scope: "user",
  },
  {
    key: "goal_accounts",
    table: "goal_accounts",
    select: "goal_id, account_id, allocated_amount, use_entire_balance, created_at",
    scope: "user",
  },
  {
    key: "goal_progress_events",
    table: "goal_progress_events",
    select: "goal_id, event_date, amount, event_type, created_at",
    scope: "user",
  },
  {
    key: "advice_progress",
    table: "advice_progress",
    select: "advice_id, task_id, content_version, completed_at",
    scope: "user",
  },
  {
    key: "category_overrides",
    table: "category_overrides",
    select: "source_category, display_category, created_at",
    scope: "user",
  },
  {
    key: "shared_expenses",
    table: "shared_expenses",
    select: "description, amount, paid_by, owed_user_id, settled_at, created_at",
    scope: "shared",
  },
  {
    key: "net_worth_snapshots",
    table: "net_worth_snapshots",
    select: "snapshot_month, assets, liabilities, created_at",
    scope: "user",
  },
  {
    key: "households",
    table: "households",
    select: "name, created_at, updated_at",
    scope: "owner",
  },
];

/**
 * Fetch every user-owned section in parallel, keyed by archive section name.
 * Throws on the first failing query; null data is coerced to empty arrays so
 * callers can spread the result straight into a payload.
 */
export async function collectUserData(
  client: Pick<SupabaseClient, "from">,
  userId: string,
): Promise<Record<string, unknown[]>> {
  const investmentsEnabled = isFeatureEnabled("investmentsPage");

  const queries = USER_DATA_TABLES.map((spec) => {
    if (spec.gated && !investmentsEnabled) {
      return Promise.resolve({ data: [], error: null });
    }
    const query = client.from(spec.table).select(spec.select);
    if (spec.scope === "user") return query.eq("user_id", userId);
    if (spec.scope === "owner") return query.eq("owner_user_id", userId);
    return query.or(`paid_by.eq.${userId},owed_user_id.eq.${userId}`);
  });

  const results = await Promise.all(queries);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;

  const sections: Record<string, unknown[]> = {};
  USER_DATA_TABLES.forEach((spec, index) => {
    sections[spec.key] = (results[index].data ?? []) as unknown[];
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
