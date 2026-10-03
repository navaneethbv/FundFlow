import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getDashboardData } from "@/lib/dashboard";
import { isFeatureEnabled } from "@/lib/feature-flags";

export interface WeeklyReviewStep {
  id: "connections" | "queue" | "budget" | "bills" | "alerts";
  label: string;
  description: string;
  count: number | null;
  complete: boolean;
  href: string;
}

export interface WeeklyReviewData {
  today: string;
  weekStart: string;
  steps: WeeklyReviewStep[];
  streak: number;
  completed: boolean;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mondayOf(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function isStaleConnection(row: { status?: unknown; last_sync_success_at?: unknown }): boolean {
  if (row.status !== "active") return true;
  if (typeof row.last_sync_success_at !== "string") return true;
  const timestamp = Date.parse(row.last_sync_success_at);
  return !Number.isFinite(timestamp) || Date.now() - timestamp > 48 * 60 * 60 * 1000;
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function countBudgetOffPace(envelopes: Array<{ monthlyLimit: number; projectedSpend: number }>): number {
  return envelopes.filter((envelope) => {
    if (envelope.monthlyLimit <= 0) return false;
    const projectedPercent = (envelope.projectedSpend / envelope.monthlyLimit) * 100;
    return Math.abs(projectedPercent - 100) > 5;
  }).length;
}

function countBillsDue(
  periods: Array<{ items: Array<{ itemType: string; nextDate: string }> }>,
  today: string,
  billEnd: string,
): number {
  return periods
    .flatMap((period) => period.items)
    .filter((item) => item.itemType === "expense" && item.nextDate >= today && item.nextDate <= billEnd).length;
}

function buildWeeklyReviewSteps(input: {
  staleConnections: number;
  queueCount: number | null;
  budgetOffPace: number;
  billsDue: number;
  alerts: number;
}): WeeklyReviewStep[] {
  const { staleConnections, queueCount, budgetOffPace, billsDue, alerts } = input;
  const connectionDescription = staleConnections === 0
    ? "All connected institutions are current."
    : `${staleConnections} ${pluralize(staleConnections, "connection needs", "connections need")} attention.`;
  let queueDescription = "No posted transactions are waiting.";
  if (queueCount === null) queueDescription = "Transaction review is not enabled yet.";
  else if (queueCount > 0) queueDescription = `${queueCount} ${pluralize(queueCount, "transaction is", "transactions are")} waiting.`;
  const budgetDescription = budgetOffPace === 0
    ? "Every budget is within five points of its monthly pace."
    : `${budgetOffPace} ${pluralize(budgetOffPace, "category is", "categories are")} more than five points off pace.`;
  const billsDescription = billsDue === 0
    ? "No recurring bills are due in the next seven days."
    : `${billsDue} ${pluralize(billsDue, "bill is", "bills are")} due in the next seven days.`;
  const alertsDescription = alerts === 0
    ? "No alerts need acknowledgement."
    : `${alerts} ${pluralize(alerts, "alert needs", "alerts need")} acknowledgement.`;
  return [
    { id: "connections", label: "Stale connections", description: connectionDescription, count: staleConnections, complete: staleConnections === 0, href: "/settings?section=institutions" },
    { id: "queue", label: "Review queue", description: queueDescription, count: queueCount, complete: queueCount === 0 || queueCount === null, href: "/transactions?review=needs_review" },
    { id: "budget", label: "Budget pace", description: budgetDescription, count: budgetOffPace, complete: budgetOffPace === 0, href: "/budget" },
    { id: "bills", label: "Bills due in seven days", description: billsDescription, count: billsDue, complete: billsDue === 0, href: "/recurring" },
    { id: "alerts", label: "Alerts", description: alertsDescription, count: alerts, complete: alerts === 0, href: "/notifications" },
  ];
}

export async function loadWeeklyReviewData(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<WeeklyReviewData> {
  const [dashboard, itemsResult, queueResult, alertsResult, streakResult] = await Promise.all([
    getDashboardData(supabase, undefined, today.slice(0, 7), userId, { includeBalanceSheet: false }),
    supabase.from("plaid_items").select("id,status,last_sync_success_at").eq("user_id", userId).limit(5000),
    isFeatureEnabled("transactionReview")
      ? supabase.from("transaction_review_ledger").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("review_status", "needs_review").eq("review_eligible", true)
      : Promise.resolve({ count: null, error: null }),
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", userId).is("read_at", null),
    supabase.from("weekly_review_streaks").select("last_completed_week,current_streak").eq("user_id", userId).maybeSingle(),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (queueResult.error) throw queueResult.error;
  if (alertsResult.error) throw alertsResult.error;
  if (streakResult.error) throw streakResult.error;

  const staleConnections = (itemsResult.data ?? []).filter(isStaleConnection).length;
  const queueCount = queueResult.count;
  const billEnd = addDays(today, 7);
  const budgetOffPace = countBudgetOffPace(dashboard.budgetEnvelopes);
  const billsDue = countBillsDue(dashboard.billPeriods.weekly, today, billEnd);
  const alerts = Math.max(alertsResult.count ?? 0, dashboard.spendingAnomalies.length);
  const weekStart = mondayOf(today);
  const streakRow = streakResult.data as { last_completed_week?: string | null; current_streak?: number | null } | null;
  const completed = streakRow?.last_completed_week === weekStart;
  return {
    today,
    weekStart,
    steps: buildWeeklyReviewSteps({ staleConnections, queueCount, budgetOffPace, billsDue, alerts }),
    streak: Number(streakRow?.current_streak ?? 0),
    completed,
  };
}
