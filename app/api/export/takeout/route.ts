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
    ] = await Promise.all([
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
      }),
    );
  } catch (error) {
    return errorResponse("export.takeout", error);
  }
}
