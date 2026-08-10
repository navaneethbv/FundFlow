import { NextResponse } from "next/server";
import { buildDataTakeout } from "@/lib/security-account";
import { errorResponse, requireUser } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";

/**
 * Full data takeout. Reads run on the cookie-bound client, but RLS alone is no
 * longer a sufficient scope: `accounts`, `transactions`, and
 * `account_balance_snapshots` are additionally readable for a household
 * member's opted-in Plaid connections. Takeout means "the caller's own data",
 * so every query below filters `user_id` explicitly — except the two
 * household-owned tables (`shared_expenses`, `households`), which are scoped
 * by the caller's involvement/ownership instead. Do not drop those filters
 * back to bare RLS.
 *
 * Every non-re-syncable user-owned table must be listed here (and in
 * `app/api/cron/backup/route.ts`) or a takeout/backup silently drops the
 * user's own splits, refund links, receipts, tags, and goals work.
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
      supabase.from("goals").select("name, target_amount, saved_amount, target_date, goal_type").eq("user_id", user.id),
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
      supabase.from("transaction_splits").select("transaction_id, category, amount, created_at").eq("user_id", user.id),
      supabase.from("transaction_annotations").select("transaction_id, note, tags, created_at, updated_at").eq("user_id", user.id),
      supabase.from("linked_refunds").select("charge_transaction_id, refund_transaction_id, amount, created_at").eq("user_id", user.id),
      supabase.from("linked_duplicates").select("subject_id, kept_transaction_id, excluded_transaction_id, created_at").eq("user_id", user.id),
      supabase.from("receipts").select("transaction_id, storage_path, merchant, purchase_date, total, status, created_at").eq("user_id", user.id),
      supabase.from("user_tags").select("name, color_slot, created_at").eq("user_id", user.id),
      supabase.from("sinking_funds").select("name, target_amount, due_date, created_at").eq("user_id", user.id),
      supabase.from("recurring_streams").select("stream_type, description, merchant_name, average_amount, last_amount, frequency, status, category, is_active, first_date, last_date, predicted_next_date, user_amount, created_at").eq("user_id", user.id),
      supabase.from("recurring_stream_transactions").select("recurring_stream_id, transaction_id, created_at").eq("user_id", user.id),
      supabase.from("milestones").select("key, title, created_at").eq("user_id", user.id),
      supabase.from("goal_accounts").select("goal_id, account_id, allocated_amount, use_entire_balance, created_at").eq("user_id", user.id),
      supabase.from("goal_progress_events").select("goal_id, event_date, amount, event_type, created_at").eq("user_id", user.id),
      supabase.from("advice_progress").select("advice_id, task_id, content_version, completed_at").eq("user_id", user.id),
      supabase.from("category_overrides").select("source_category, display_category, created_at").eq("user_id", user.id),
      // No user_id column: the caller's share of a household's debts. Scoped to
      // rows they paid or owe so takeout doesn't export the whole household.
      supabase.from("shared_expenses").select("description, amount, paid_by, owed_user_id, settled_at, created_at").or(`paid_by.eq.${user.id},owed_user_id.eq.${user.id}`),
      supabase.from("net_worth_snapshots").select("snapshot_month, assets, liabilities, created_at").eq("user_id", user.id),
      // The caller's own households only — households they merely joined belong
      // to their owner's takeout, not this one.
      supabase.from("households").select("name, created_at, updated_at").eq("owner_user_id", user.id),
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
      transactionSplits,
      transactionAnnotations,
      linkedRefunds,
      linkedDuplicates,
      receipts,
      userTags,
      sinkingFunds,
      recurringStreams,
      recurringStreamTransactions,
      milestones,
      goalAccounts,
      goalProgressEvents,
      adviceProgress,
      categoryOverrides,
      sharedExpenses,
      netWorthSnapshots,
      households,
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
        transaction_splits: transactionSplits ?? [],
        transaction_annotations: transactionAnnotations ?? [],
        linked_refunds: linkedRefunds ?? [],
        linked_duplicates: linkedDuplicates ?? [],
        receipts: receipts ?? [],
        user_tags: userTags ?? [],
        sinking_funds: sinkingFunds ?? [],
        recurring_streams: recurringStreams ?? [],
        recurring_stream_transactions: recurringStreamTransactions ?? [],
        milestones: milestones ?? [],
        goal_accounts: goalAccounts ?? [],
        goal_progress_events: goalProgressEvents ?? [],
        advice_progress: adviceProgress ?? [],
        category_overrides: categoryOverrides ?? [],
        shared_expenses: sharedExpenses ?? [],
        net_worth_snapshots: netWorthSnapshots ?? [],
        households: households ?? [],
      }),
    );
  } catch (error) {
    return errorResponse("export.takeout", error);
  }
}
