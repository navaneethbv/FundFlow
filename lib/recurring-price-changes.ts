export interface PaidOccurrence {
  date: string;
  amount: number;
}

export interface ConfirmedPriceChange {
  effectiveDate: string;
  previousAmount: number;
  newAmount: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * A change is confirmed only when the two latest linked payments agree on a
 * new amount and there is an older payment to compare with. The join table
 * contains one row per settled transaction, so each input occurrence already
 * represents one payment.
 */
export function detectConfirmedPriceChange(occurrences: PaidOccurrence[]): ConfirmedPriceChange | null {
  const sorted = occurrences
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.amount) && row.amount > 0)
    .toSorted((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 3) return null;
  const latest = sorted.at(-1)!;
  const prior = sorted.at(-2)!;
  const baseline = sorted.at(-3)!;
  const latestAmount = round2(latest.amount);
  const priorAmount = round2(prior.amount);
  const baselineAmount = round2(baseline.amount);
  if (latestAmount !== priorAmount || latestAmount <= baselineAmount) return null;
  return { effectiveDate: prior.date, previousAmount: baselineAmount, newAmount: latestAmount };
}
