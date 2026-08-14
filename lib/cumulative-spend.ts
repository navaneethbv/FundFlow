import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

export interface CumulativeSpendDay {
  day: number;
  thisMonth: number | null;
  lastMonth: number | null;
}

export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
}

export function shiftMonthKey(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const total = year! * 12 + (monthNumber! - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * Cumulative spend per day for `month` and the month before it, aligned by day
 * of month. Powers the Spending vs last month widget (Phase 8).
 *
 * Two nulls carry meaning and must not be flattened to zero:
 *
 *   * `thisMonth` is null after `today`. A zero there would draw the line along
 *     the floor, which reads as "spent nothing" rather than "not yet happened".
 *   * `lastMonth` is null past the previous month's final day. Comparing a
 *     31-day month against February leaves days 29-31 with no counterpart, and
 *     carrying the final value forward would claim a spending pause that never
 *     happened. The chart's table twin fills it forward for reading; the
 *     plotted line stops.
 *
 * Dates are compared as `YYYY-MM-DD` strings throughout, so no timezone can
 * shift a day boundary. Spending is `flow === "expense"` only, which excludes
 * transfers, both halves of a linked refund, and credit-card payments.
 */
export function computeCumulativeSpendByDay(
  txns: CanonicalFinanceTransaction[],
  month: string,
  today: string,
): CumulativeSpendDay[] {
  const previousMonth = shiftMonthKey(month, -1);
  const thisMonthDays = daysInMonth(month);
  const lastMonthDays = daysInMonth(previousMonth);

  const perDay = (target: string): number[] => {
    const totals = new Array<number>(32).fill(0);
    for (const row of txns) {
      if (row.flow !== "expense") continue;
      if (!row.date.startsWith(`${target}-`)) continue;
      const day = Number(row.date.slice(8, 10));
      if (!Number.isInteger(day) || day < 1 || day > 31) continue;
      totals[day] += Math.abs(row.signedAmount);
    }
    return totals;
  };

  const thisDaily = perDay(month);
  const lastDaily = perDay(previousMonth);

  const rows: CumulativeSpendDay[] = [];
  let thisRunning = 0;
  let lastRunning = 0;

  for (let day = 1; day <= thisMonthDays; day += 1) {
    thisRunning += thisDaily[day]!;
    if (day <= lastMonthDays) lastRunning += lastDaily[day]!;

    const dayKey = `${month}-${String(day).padStart(2, "0")}`;
    rows.push({
      day,
      thisMonth: dayKey <= today ? Math.round(thisRunning * 100) / 100 : null,
      lastMonth:
        day <= lastMonthDays ? Math.round(lastRunning * 100) / 100 : null,
    });
  }

  return rows;
}
