/**
 * Calculates savings rate as `((income - spending) / income) * 100`.
 * When income <= 0, returns null ("N/A") because percentage has no meaningful denominator.
 * Negative savings rates (overspending) are preserved as signed numbers and NOT clamped to zero.
 */
export function computeSavingsRate(
  income: number | null = 0,
  spending: number | null = 0,
): number | null {
  const inc = income ?? 0;
  const spend = spending ?? 0;
  if (inc <= 0) return null;
  const rate = ((inc - spend) / inc) * 100;
  return Math.round((rate + Number.EPSILON) * 100) / 100;
}
