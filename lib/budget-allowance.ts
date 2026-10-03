import { validPaydayDate } from "@/lib/payday";
import { parseDate } from "@/lib/date-utils";
export interface BudgetAllowance {
  budget: number;
  spent: number;
  left: number;
  daily: number;
  daysLeft: number;
  monthEnd: string;
  nextPayday: string | null;
  daysUntilPayday: number | null;
}
/** Pace the whole expense budget, including rollover and unbudgeted spending. */
export function computeBudgetAllowance(input: {
  today: string;
  limits: number[];
  spent: number;
  nextPayday: string | null;
}): BudgetAllowance | null {
  if (!validPaydayDate(input.today))
    throw new RangeError("Invalid allowance date");
  if (!input.limits.length) return null;
  if (
    ![input.spent, ...input.limits].every(
      (value) => Number.isFinite(value) && Math.abs(value) <= 1e12,
    )
  )
    throw new RangeError("Invalid allowance amount");
  const budget = input.limits.reduce(
    (sum, value) => sum + Math.round(value * 100),
    0,
  );
  const spent = Math.round(input.spent * 100);
  const date = parseDate(input.today);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const daysLeft = lastDay - date.getUTCDate() + 1;
  const nextPayday =
    validPaydayDate(input.nextPayday) && input.nextPayday >= input.today
      ? input.nextPayday
      : null;
  return {
    budget: budget / 100,
    spent: spent / 100,
    left: (budget - spent) / 100,
    daily: Math.floor((budget - spent) / daysLeft) / 100,
    daysLeft,
    monthEnd: `${input.today.slice(0, 7)}-${lastDay}`,
    nextPayday,
    daysUntilPayday: nextPayday
      ? Math.round(
          (parseDate(nextPayday).getTime() - date.getTime()) / 86400000,
        )
      : null,
  };
}
