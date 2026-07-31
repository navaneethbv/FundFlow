/**
 * Phase 9B: cash-flow-adjusted (time-weighted) portfolio return.
 *
 * A raw balance chart conflates "the market moved" with "I added money" — a
 * $10,000 deposit reads identically to a 100% gain on a $10,000 balance.
 * Time-weighted return removes contributions and withdrawals from the
 * calculation so what's left is purely investment performance.
 *
 * `externalFlows.amount` uses this module's own sign convention, not Plaid's:
 * positive = money added to the portfolio (a deposit/contribution), negative
 * = money withdrawn. The sync layer maps Plaid's sign onto this before
 * calling in — Plaid's investment-transaction amount is positive when it
 * debits the account (a buy, a fee, a withdrawal) and negative when it
 * credits it (a sell, a deposit), the opposite of what a "money added" number
 * needs, so the mapping negates it.
 */

export interface Valuation {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface ExternalFlow {
  date: string; // YYYY-MM-DD
  amount: number; // positive = deposited, negative = withdrawn
}

export interface ReturnPoint {
  date: string;
  pct: number; // cumulative return since the first valuation, as a percentage
}

/** At least two valuation points are needed before any return is meaningful. */
export function hasSufficientPerformanceData(valuations: Valuation[]): boolean {
  return valuations.length >= 2;
}

/**
 * Chain-links a simplified Modified Dietz return across each pair of
 * consecutive valuations, attributing every external flow between them to
 * the start of that sub-period. A sub-period whose starting base (valuation
 * plus flows) is zero cannot support a percentage return — money that didn't
 * exist yet growing without a matching recorded flow is treated as a data
 * gap, not an infinite gain, so that sub-period contributes 0%.
 */
export function computeTimeWeightedReturn(input: {
  valuations: Valuation[];
  externalFlows: ExternalFlow[];
}): ReturnPoint[] {
  const valuations = [...input.valuations].sort((a, b) => a.date.localeCompare(b.date));
  if (valuations.length === 0) return [];
  if (valuations.length === 1) return [{ date: valuations[0].date, pct: 0 }];

  const points: ReturnPoint[] = [{ date: valuations[0].date, pct: 0 }];
  let cumulative = 0;

  for (let i = 1; i < valuations.length; i += 1) {
    const prev = valuations[i - 1];
    const curr = valuations[i];
    const flowSum = input.externalFlows
      .filter((f) => f.date > prev.date && f.date <= curr.date)
      .reduce((sum, f) => sum + f.amount, 0);

    const base = prev.value + flowSum;
    const subReturn = base === 0 ? 0 : (curr.value - prev.value - flowSum) / base;

    cumulative = (1 + cumulative) * (1 + subReturn) - 1;
    points.push({ date: curr.date, pct: Math.round(cumulative * 10000) / 100 });
  }

  return points;
}
