import type { FundedGoal } from "@/lib/goals-v2";

export const GOAL_PROJECTION_MAX_MONTHS = 36;

export interface GoalProjectionPoint {
  month: string;
  funded: number;
  target: number;
  isTargetMonth: boolean;
}

export interface GoalProjection {
  points: GoalProjectionPoint[];
  monthlyPace: number;
  targetAmount: number;
  targetMonth: string;
  capped: boolean;
}

function parseMonth(month: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;
  return { year, month: monthNumber };
}

function monthDistance(from: { year: number; month: number }, to: { year: number; month: number }): number {
  return (to.year - from.year) * 12 + to.month - from.month;
}

function monthAt(start: { year: number; month: number }, offset: number): string {
  const absolute = start.year * 12 + start.month - 1 + offset;
  const year = Math.floor(absolute / 12);
  const month = (absolute % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Builds a deterministic, user-assumption-only goal projection.
 *
 * The current funded amount is the observed starting point. The only forward
 * input is the goal's existing required or planned monthly pace. There is no
 * confidence band, market return, or inferred income in this chart.
 */
export function buildGoalProjection(
  goal: FundedGoal,
  startMonth: string,
  maxMonths = GOAL_PROJECTION_MAX_MONTHS,
): GoalProjection | null {
  const start = parseMonth(startMonth);
  const targetMonth = goal.target_date?.slice(0, 7) ?? null;
  const target = targetMonth ? parseMonth(targetMonth) : null;
  const monthlyPace = goal.est_monthly ?? goal.monthly_contribution ?? 0;
  const targetAmount = goal.funded_amount + goal.remainingAmount;

  if (
    !start ||
    !target ||
    !targetMonth ||
    targetAmount <= 0 ||
    goal.remainingAmount <= 0 ||
    !Number.isFinite(monthlyPace) ||
    monthlyPace <= 0
  ) {
    return null;
  }

  const monthsToTarget = monthDistance(start, target);
  if (monthsToTarget < 1) return null;

  const safeMaxMonths = Math.max(1, Math.floor(maxMonths));
  const months = Math.min(monthsToTarget, safeMaxMonths);
  const points = Array.from({ length: months + 1 }, (_, index) => {
    const month = monthAt(start, index);
    return {
      month,
      funded: Math.min(
        targetAmount,
        Math.round((goal.funded_amount + monthlyPace * index) * 100) / 100,
      ),
      target: targetAmount,
      isTargetMonth: month === targetMonth,
    };
  });

  return {
    points,
    monthlyPace,
    targetAmount,
    targetMonth,
    capped: months < monthsToTarget,
  };
}
