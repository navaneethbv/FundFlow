import type { createClient } from "@/lib/supabase/server";

export interface Goal {
  id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  target_date: string | null;
  /** Household the goal is shared with (4.2-lite); null = private. */
  household_id?: string | null;
}

export type GoalStatus = "completed" | "overdue" | "on-track" | "no-date";

export interface GoalSummaryItem {
  goal: Goal;
  progressPct: number;
  remainingAmount: number;
  monthlyPace: number | null;
  status: GoalStatus;
}

/** Percentage of a goal's target that has been saved, clamped to 0-100. */
export function goalProgressPct(saved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((saved / target) * 100)));
}

export function goalRemainingAmount(goal: Pick<Goal, "target_amount" | "saved_amount">): number {
  return Math.max(0, Math.round((goal.target_amount - goal.saved_amount) * 100) / 100);
}

function parseGoalDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1));
}

function monthSpan(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  return months + (to.getUTCDate() >= from.getUTCDate() ? 0 : -1);
}

export function goalMonthlyPace(goal: Goal, today = new Date()): number | null {
  if (!goal.target_date) return null;
  const targetDate = parseGoalDate(goal.target_date);
  if (targetDate <= today) return null;
  const remaining = goalRemainingAmount(goal);
  if (remaining <= 0) return 0;
  const monthsRemaining = Math.max(1, monthSpan(today, targetDate));
  return Math.round((remaining / monthsRemaining) * 100) / 100;
}

export function goalStatus(goal: Goal, today = new Date()): GoalStatus {
  if (goalRemainingAmount(goal) <= 0) return "completed";
  if (!goal.target_date) return "no-date";
  return parseGoalDate(goal.target_date) < today ? "overdue" : "on-track";
}

export function goalSummary(goals: Goal[], today = new Date()): GoalSummaryItem[] {
  return goals
    .map((goal) => ({
      goal,
      progressPct: goalProgressPct(goal.saved_amount, goal.target_amount),
      remainingAmount: goalRemainingAmount(goal),
      monthlyPace: goalMonthlyPace(goal, today),
      status: goalStatus(goal, today),
    }))
    .sort((a, b) => {
      const statusRank = (item: GoalSummaryItem) => (item.status === "completed" ? 2 : 0);
      const rankDiff = statusRank(a) - statusRank(b);
      if (rankDiff !== 0) return rankDiff;
      if (a.goal.target_date && b.goal.target_date) {
        return a.goal.target_date.localeCompare(b.goal.target_date);
      }
      if (a.goal.target_date) return -1;
      if (b.goal.target_date) return 1;
      return a.goal.name.localeCompare(b.goal.name);
    });
}

/**
 * Owner-scoped goals, oldest first. Page/route callers pass the RLS-bound
 * client and omit `userId` (RLS scopes the rows). Service-client callers
 * (RLS bypassed) MUST pass `userId` so the query is scoped explicitly —
 * otherwise it returns every user's goals.
 */
export async function getGoals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId?: string,
): Promise<Goal[]> {
  let query = supabase
    .from("goals")
    .select("id, name, target_amount, saved_amount, target_date, household_id")
    .order("created_at");
  if (userId) query = query.eq("user_id", userId);
  const { data } = await query;
  return (data ?? []) as Goal[];
}
