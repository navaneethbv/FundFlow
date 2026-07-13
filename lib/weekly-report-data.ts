import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MerchantRule } from "@/lib/planning";
import type { WeeklyReportPeriod } from "@/lib/report-period";
import {
  buildWeeklyReportModel,
  type WeeklyReportAccount,
  type WeeklyReportData,
  type WeeklyReportTransaction,
} from "@/lib/weekly-report";

function throwIfError(error: { message?: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error.message ?? "query failed"}`);
}

export async function getWeeklyReportData(
  supabase: SupabaseClient,
  userId: string,
  period: WeeklyReportPeriod,
): Promise<WeeklyReportData | null> {
  const { data: userData, error: userError } =
    await supabase.auth.admin.getUserById(userId);
  throwIfError(userError, "weekly report user");
  const userEmail = userData?.user?.email;
  if (!userEmail) return null;

  const [
    accountsResult,
    institutionsResult,
    budgetsResult,
    rulesResult,
    refundsResult,
    decisionsResult,
    transactionsResult,
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, type, plaid_item_id")
      .eq("user_id", userId),
    supabase
      .from("plaid_items")
      .select("id, institution_name")
      .eq("user_id", userId),
    supabase
      .from("budgets")
      .select("category, monthly_limit")
      .eq("user_id", userId),
    supabase
      .from("merchant_rules")
      .select("match_type, pattern, display_name, category, enabled")
      .eq("user_id", userId)
      .order("created_at"),
    supabase
      .from("linked_refunds")
      .select("charge_transaction_id, refund_transaction_id")
      .eq("user_id", userId),
    supabase
      .from("transaction_review_decisions")
      .select("subject_id")
      .eq("user_id", userId)
      .eq("kind", "duplicate")
      .eq("decision", "confirmed"),
    supabase
      .from("transactions")
      .select("id, date, amount, merchant_name, name, pfc_primary, account_id")
      .eq("user_id", userId)
      .gte("date", period.previousStart)
      .lte("date", period.end),
  ]);

  for (const [context, result] of [
    ["accounts", accountsResult],
    ["institutions", institutionsResult],
    ["budgets", budgetsResult],
    ["merchant rules", rulesResult],
    ["linked refunds", refundsResult],
    ["duplicate decisions", decisionsResult],
    ["transactions", transactionsResult],
  ] as const) {
    throwIfError(result.error, `weekly report ${context}`);
  }

  const transactionIds = (transactionsResult.data ?? []).map(
    (transaction) => transaction.id as string,
  );
  const splitsResult = transactionIds.length
    ? await supabase
        .from("transaction_splits")
        .select("transaction_id, category, amount")
        .eq("user_id", userId)
        .in("transaction_id", transactionIds)
    : { data: [], error: null };
  throwIfError(splitsResult.error, "weekly report transaction splits");

  const accounts: WeeklyReportAccount[] = (accountsResult.data ?? []).map(
    (account) => ({
      id: account.id as string,
      name: account.name as string | null,
      type: account.type as string | null,
      plaidItemId: account.plaid_item_id as string,
    }),
  );
  const transactions: WeeklyReportTransaction[] = (
    transactionsResult.data ?? []
  ).map((transaction) => ({
    id: transaction.id as string,
    date: transaction.date as string,
    amount: Number(transaction.amount),
    merchantName: transaction.merchant_name as string | null,
    name: transaction.name as string | null,
    category: transaction.pfc_primary as string | null,
    accountId: transaction.account_id as string,
  }));
  const merchantRules: MerchantRule[] = (rulesResult.data ?? []).map((rule) => ({
    matchType: rule.match_type as MerchantRule["matchType"],
    pattern: rule.pattern as string,
    displayName: rule.display_name as string | null,
    category: rule.category as string | null,
    enabled: Boolean(rule.enabled),
  }));

  const linkedRefundTransactionIds = new Set<string>();
  for (const refund of refundsResult.data ?? []) {
    linkedRefundTransactionIds.add(refund.charge_transaction_id as string);
    linkedRefundTransactionIds.add(refund.refund_transaction_id as string);
  }

  return buildWeeklyReportModel({
    userId,
    userEmail,
    period,
    accounts,
    transactions,
    institutions: (institutionsResult.data ?? []).map((institution) => ({
      id: institution.id as string,
      name: institution.institution_name as string | null,
    })),
    budgets: (budgetsResult.data ?? []).map((budget) => ({
      category: budget.category as string,
      monthlyLimit: Number(budget.monthly_limit),
    })),
    merchantRules,
    splits: (splitsResult.data ?? []).map((split) => ({
      transactionId: split.transaction_id as string,
      category: split.category as string,
      amount: Number(split.amount),
    })),
    linkedRefundTransactionIds,
    duplicateTransactionIds: new Set(
      (decisionsResult.data ?? []).map(
        (decision) => decision.subject_id as string,
      ),
    ),
  });
}
