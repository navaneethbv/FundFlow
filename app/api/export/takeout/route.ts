import { NextResponse } from "next/server";
import { buildDataTakeout } from "@/lib/security-account";
import { errorResponse, requireUser } from "@/lib/http";

/**
 * Full data takeout. Reads run on the cookie-bound client, but RLS alone is no
 * longer a sufficient scope: `accounts`, `transactions`, and
 * `account_balance_snapshots` are additionally readable for a household
 * member's opted-in Plaid connections. Takeout means "the caller's own data",
 * so every query below filters `user_id` explicitly — do not drop those
 * filters back to bare RLS.
 *
 * ADDING A USER-OWNED TABLE? It belongs in this list unless it is derived data
 * the user cannot meaningfully re-read (sync bookkeeping, rate-limit windows)
 * or a secret they must never receive back (Plaid tokens, MFA backup codes).
 * The matching checklist lives in three other places:
 *   - encrypted backup:   app/api/cron/backup/route.ts
 *   - account deletion:   the table's `user_id` FK must be
 *                         `references auth.users (id) on delete cascade`,
 *                         which is what app/api/account/route.ts relies on
 *   - RLS proof:          scripts/check-rls.sql needs no edit; it fails for any
 *                         public table lacking RLS or lacking a policy
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const [
      { data: accounts },
      { data: transactions },
      { data: budgets },
      { data: goals },
      { data: rules },
      { data: manualAccounts },
      { data: accountBalanceSnapshots },
      { data: alertPreferences },
      { data: aiSettings },
      { data: budgetPeriods },
      { data: savedReports },
      { data: goalAccounts },
      { data: goalProgressEvents },
      { data: securities },
      { data: holdings },
      { data: holdingSnapshots },
      { data: investmentTransactions },
      { data: adviceProgress },
      { data: receipts },
      { data: userTags },
    ] = await Promise.all([
      supabase.from("accounts").select("name, official_name, mask, type, subtype, current_balance, available_balance, credit_limit, iso_currency_code").eq("user_id", user.id),
      supabase.from("transactions").select("date, amount, iso_currency_code, name, merchant_name, pfc_primary, pfc_detailed, pending").eq("user_id", user.id),
      supabase.from("budgets").select("category, monthly_limit"),
      supabase.from("goals").select("name, target_amount, current_amount, target_date, status"),
      supabase.from("merchant_rules").select("match_type, pattern, display_name, category, enabled"),
      supabase.from("manual_accounts").select("name, account_type, balance, include_in_net_worth"),
      supabase.from("account_balance_snapshots").select("account_id, manual_account_id, snapshot_date, current_balance, available_balance, iso_currency_code").eq("user_id", user.id),
      supabase.from("alert_preferences").select("broken_bank, budget_exceeded, goal_reached, large_transaction, low_cash_forecast"),
      supabase.from("ai_settings").select("enabled"),
      supabase.from("budget_periods").select("budget_id, month, planned").eq("user_id", user.id),
      supabase.from("saved_reports").select("name, report_type, filters").eq("user_id", user.id),
      supabase.from("goal_accounts").select("goal_id, account_id, allocated_amount, use_entire_balance").eq("user_id", user.id),
      supabase.from("goal_progress_events").select("goal_id, event_date, amount, event_type").eq("user_id", user.id),
      supabase.from("securities").select("ticker, name, security_type, close_price").eq("user_id", user.id),
      supabase.from("holdings").select("security_id, quantity, cost_basis, institution_price, institution_value, source").eq("user_id", user.id),
      supabase.from("holding_snapshots").select("holding_id, snapshot_date, quantity, price, value").eq("user_id", user.id),
      supabase.from("investment_transactions").select("date, name, amount, quantity, price, fees, txn_type").eq("user_id", user.id),
      supabase.from("advice_progress").select("advice_id, task_id, content_version, completed_at").eq("user_id", user.id),
      supabase.from("receipts").select("merchant, purchase_date, total, status").eq("user_id", user.id),
      supabase.from("user_tags").select("name, color_slot").eq("user_id", user.id),
    ]);

    return NextResponse.json(
      buildDataTakeout({
        accounts: accounts ?? [],
        transactions: transactions ?? [],
        budgets: budgets ?? [],
        goals: goals ?? [],
        merchant_rules: rules ?? [],
        manual_accounts: manualAccounts ?? [],
        account_balance_snapshots: accountBalanceSnapshots ?? [],
        alert_preferences: alertPreferences ?? [],
        ai_settings: aiSettings ?? [],
        budget_periods: budgetPeriods ?? [],
        saved_reports: savedReports ?? [],
        goal_accounts: goalAccounts ?? [],
        goal_progress_events: goalProgressEvents ?? [],
        securities: securities ?? [],
        holdings: holdings ?? [],
        holding_snapshots: holdingSnapshots ?? [],
        investment_transactions: investmentTransactions ?? [],
        advice_progress: adviceProgress ?? [],
        receipts: receipts ?? [],
        user_tags: userTags ?? [],
      }),
    );
  } catch (error) {
    return errorResponse("export.takeout", error);
  }
}
