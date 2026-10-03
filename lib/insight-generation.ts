import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCanonicalProjection, monthWindow } from "@/lib/finance-query";
import { loadRecurringData } from "@/lib/recurring-data";
import { loadGoalsPageData } from "@/lib/goals-data";
import { generateInsights, type Insight } from "@/lib/insight-generators";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { addDays, parseDate } from "@/lib/date-utils";

/** Caller supplies the cookie client for reads, or the cron's scoped service client. */
export async function loadGeneratedInsights(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<Insight[]> {
  if (!isFeatureEnabled("insightGenerators")) return [];
  const month = today.slice(0, 7);
  const window = { ...monthWindow(month, 3), endExclusive: addDays(today, 1) };
  const [projection, recurring, goals, accountsResult, activityResult] = await Promise.all([
    loadCanonicalProjection(supabase, {
      scope: { kind: "mine", ownerUserId: userId },
      window,
      excludePending: true,
      maxRows: 5000,
    }),
    loadRecurringData(supabase, { userId, anchorMonth: month, today }),
    loadGoalsPageData(supabase, userId, parseDate(today)),
    supabase
      .from("accounts")
      .select("id,name,type,current_balance,iso_currency_code,created_at")
      .eq("user_id", userId)
      .limit(1000),
    supabase.from("transactions").select("account_id,date")
      .eq("user_id", userId).gte("date", addDays(today, -60))
      .lte("date", today).limit(5001),
  ]);
  if (accountsResult.error) throw accountsResult.error;
  if (activityResult.error) throw activityResult.error;
  if (projection.truncated || accountsResult.data?.length === 1000 || (activityResult.data?.length ?? 0) > 5000)
    throw new Error(
      "Insight input limit reached; no partial signals generated",
    );
  const accounts = accountsResult.data ?? [];
  const allUsd = accounts.every(
    (account) => account.iso_currency_code === "USD",
  );
  const transactions = projection.transactions.filter(
    (row) =>
      projection.currencyByAccountId.get(
        row.accountId ?? row.manualAccountId ?? "",
      ) === "USD",
  );
  const lastActivity = new Map<string, string>();
  // Even excluded, pending and transfer rows establish account activity.
  for (const row of activityResult.data ?? []) {
    if (row.account_id && row.date > (lastActivity.get(row.account_id) ?? ""))
      lastActivity.set(row.account_id, row.date);
  }
  return generateInsights({
    today,
    historyStart: window.start,
    transactions,
    // The recurring loader combines currencies; refuse monetary signals for mixed account sets.
    bills: allUsd
      ? recurring.view.occurrences
          .filter((bill) => !bill.isIncome)
          .map((bill) => ({
            id: bill.sourceId,
            name: bill.merchant,
            amount: bill.amount,
            dueDate: bill.dueDate,
            overdue: bill.status === "overdue",
          }))
      : [],
    accounts: accounts
      .filter(
        (account) =>
          account.type === "depository" && account.iso_currency_code === "USD",
      )
      .map((account) => ({
        id: account.id,
        name: account.name ?? "Account",
        balance:
          account.current_balance == null
            ? null
            : Number(account.current_balance),
        opened: account.created_at.slice(0, 10),
        lastActivity: lastActivity.get(account.id) ?? null,
      })),
    reserves: allUsd
      ? goals.goals
          .filter(
            (goal) => goal.goal_type === "save_up" && goal.spending_reduces,
          )
          .map((goal) => ({
            id: goal.id,
            name: goal.name,
            target: goal.target_amount,
            funded: goal.funded_amount,
          }))
      : [],
  });
}

/** In-app journal only: deliberately bypass outbound push and email delivery. */
export async function persistGeneratedInsights(
  writer: SupabaseClient,
  userId: string,
  insights: Insight[],
  preferences: Record<string, unknown> | null,
): Promise<void> {
  if (!isFeatureEnabled("insightGenerators")) return;
  const rows = insights
    .filter((item) => preferences?.[item.type] === true)
    .map((item) => ({
      user_id: userId,
      type: item.type,
      subject_key: item.subjectKey,
      title: item.details.title.slice(0, 160),
      body: item.details.body.slice(0, 500),
      severity: [
        "double_charge",
        "bill_overdue",
        "goal_reserve_depleted",
      ].includes(item.type)
        ? "warning"
        : "info",
    }));
  if (!rows.length) return;
  const { error } = await writer
    .from("notifications")
    .upsert(rows, {
      onConflict: "user_id,type,subject_key",
      ignoreDuplicates: true,
    });
  if (error) throw error;
}
