import type { FundedGoal } from "@/lib/goals-v2";
import {
  goalMonthlyPace,
  goalProgressPct,
  goalRemainingAmount,
  type Goal,
} from "@/lib/goals";

export interface GoalSummaryItem {
  id: string;
  name: string;
  targetAmount: number;
  fundedAmount: number;
  remainingAmount: number;
  progressPct: number;
  monthlyPace: number | null;
  /**
   * The goal's own deadline. `monthlyPace` is null for a goal with no date
   * *and* for one already past due, so planning surfaces need the date itself
   * to tell "no deadline" apart from "overdue".
   */
  targetDate: string | null;
  complete: boolean;
}

export function toGoalSummaryItem(goal: FundedGoal): GoalSummaryItem {
  const targetAmount = goal.funded_amount + goal.remainingAmount;
  return {
    id: goal.id,
    name: goal.name,
    targetAmount,
    fundedAmount: goal.funded_amount,
    remainingAmount: goal.remainingAmount,
    progressPct: goal.progressPct,
    monthlyPace: goal.est_monthly,
    targetDate: goal.target_date ?? null,
    complete:
      goal.progressPct >= 100 ||
      goal.badge === "completed",
  };
}

export function toLegacyGoalSummaryItem(
  goal: Goal,
  today = new Date(),
): GoalSummaryItem {
  const remaining = goalRemainingAmount(goal);
  const progress = goalProgressPct(goal.saved_amount, goal.target_amount);
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: goal.target_amount,
    fundedAmount: goal.saved_amount,
    remainingAmount: remaining,
    progressPct: progress,
    monthlyPace: goalMonthlyPace(goal, today),
    targetDate: goal.target_date ?? null,
    complete: remaining <= 0,
  };
}
