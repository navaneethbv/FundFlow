import { NextResponse } from "next/server";
import { buildDataTakeout } from "@/lib/security-account";
import { errorResponse, requireUser } from "@/lib/http";

/**
 * Full data takeout. Reads run on the cookie-bound client, so RLS scopes every
 * table to the caller.
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
  const { supabase } = auth;

  try {
    const [
      { data: accounts },
      { data: transactions },
      { data: budgets },
      { data: goals },
      { data: rules },
      { data: manualAccounts },
      { data: alertPreferences },
      { data: aiSettings },
    ] = await Promise.all([
      supabase.from("accounts").select("name, official_name, mask, type, subtype, current_balance, available_balance, credit_limit, iso_currency_code"),
      supabase.from("transactions").select("date, amount, iso_currency_code, name, merchant_name, pfc_primary, pfc_detailed, pending"),
      supabase.from("budgets").select("category, monthly_limit"),
      supabase.from("goals").select("name, target_amount, current_amount, target_date, status"),
      supabase.from("merchant_rules").select("match_type, pattern, display_name, category, enabled"),
      supabase.from("manual_accounts").select("name, account_type, balance, include_in_net_worth"),
      supabase.from("alert_preferences").select("broken_bank, budget_exceeded, goal_reached, large_transaction, low_cash_forecast"),
      supabase.from("ai_settings").select("enabled"),
    ]);

    return NextResponse.json(
      buildDataTakeout({
        accounts: accounts ?? [],
        transactions: transactions ?? [],
        budgets: budgets ?? [],
        goals: goals ?? [],
        merchant_rules: rules ?? [],
        manual_accounts: manualAccounts ?? [],
        alert_preferences: alertPreferences ?? [],
        ai_settings: aiSettings ?? [],
      }),
    );
  } catch (error) {
    return errorResponse("export.takeout", error);
  }
}
