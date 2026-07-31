import { NextResponse } from "next/server";
import { buildDataTakeout } from "@/lib/security-account";
import { errorResponse, requireUser } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";

/**
 * Full data takeout. Reads run on the cookie-bound client, but RLS alone is no
 * longer a sufficient scope: `accounts`, `transactions`, and
 * `account_balance_snapshots` are additionally readable for a household
 * member's opted-in Plaid connections. Takeout means "the caller's own data",
 * so every query below filters `user_id` explicitly. Do not drop those
 * filters back to bare RLS.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    // Gated: holdings/securities/holding_snapshots only exist once
    // 20260730210000_investments.sql is applied. Querying them unconditionally
    // would break every user's takeout, not just investors', on a deployment
    // that hasn't run the migration yet.
    const investmentsEnabled = isFeatureEnabled("investmentsPage");

    const results = await Promise.all([
      supabase.from("accounts").select("name, official_name, mask, type, subtype, current_balance, available_balance, credit_limit, iso_currency_code").eq("user_id", user.id),
      supabase.from("transactions").select("date, amount, iso_currency_code, name, merchant_name, pfc_primary, pfc_detailed, pending").eq("user_id", user.id),
      supabase.from("budgets").select("category, monthly_limit").eq("user_id", user.id),
      supabase.from("goals").select("name, target_amount, current_amount, target_date, status").eq("user_id", user.id),
      supabase.from("merchant_rules").select("match_type, pattern, display_name, category, enabled").eq("user_id", user.id),
      supabase.from("manual_accounts").select("name, account_type, balance, include_in_net_worth").eq("user_id", user.id),
      supabase.from("account_balance_snapshots").select("account_id, manual_account_id, snapshot_date, current_balance, available_balance, iso_currency_code").eq("user_id", user.id),
      supabase.from("alert_preferences").select("broken_bank, budget_exceeded, goal_reached, large_transaction, low_cash_forecast").eq("user_id", user.id),
      supabase.from("ai_settings").select("enabled").eq("user_id", user.id),
      supabase.from("budget_periods").select("budget_id, month, planned").eq("user_id", user.id),
      supabase.from("saved_reports").select("name, report_type, filters, created_at, updated_at").eq("user_id", user.id),
      investmentsEnabled
        ? supabase.from("holdings").select("account_id, manual_account_id, quantity, cost_basis, institution_price, institution_value, as_of, source, is_active").eq("user_id", user.id)
        : Promise.resolve({ data: [], error: null }),
      investmentsEnabled
        ? supabase.from("holding_snapshots").select("holding_id, snapshot_date, quantity, price, value").eq("user_id", user.id)
        : Promise.resolve({ data: [], error: null }),
      investmentsEnabled
        // Plaid-sourced securities carry no per-user data (see the migration);
        // only the caller's own manually-entered securities count as "their data".
        ? supabase.from("securities").select("name, ticker, security_type, security_subtype, close_price, close_price_as_of, iso_currency_code").eq("user_id", user.id)
        : Promise.resolve({ data: [], error: null }),
      investmentsEnabled
        ? supabase.from("investment_transactions").select("date, name, amount, quantity, price, fees, txn_type, txn_subtype, iso_currency_code").eq("user_id", user.id)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
    const [
      accounts,
      transactions,
      budgets,
      goals,
      rules,
      manualAccounts,
      accountBalanceSnapshots,
      alertPreferences,
      aiSettings,
      budgetPeriods,
      savedReports,
      holdings,
      holdingSnapshots,
      securities,
      investmentTransactions,
    ] = results.map((result) => result.data);

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
        holdings: holdings ?? [],
        holding_snapshots: holdingSnapshots ?? [],
        securities: securities ?? [],
        investment_transactions: investmentTransactions ?? [],
      }),
    );
  } catch (error) {
    return errorResponse("export.takeout", error);
  }
}
