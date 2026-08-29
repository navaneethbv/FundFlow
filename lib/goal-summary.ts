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
  complete: boolean;
}

export function toGoalSummaryItem(goal: FundedGoal): GoalSummaryItem {
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: goal.target_amount,
    fundedAmount: goal.funded_amount,
    remainingAmount: goal.remainingAmount,
    progressPct: goal.progressPct,
    monthlyPace: goal.est_monthly,
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
    complete: remaining <= 0,
  };
}
