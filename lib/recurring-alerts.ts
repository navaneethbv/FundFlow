/**
 * Subscription & Recurring Price Spike Detection Engine.
 * Identifies price increases across active recurring streams and subscriptions,
 * calculating monthly deltas, percentage hikes, and annual budget impacts.
 */

export interface RecurringStreamCandidate {
  id: string;
  merchantName?: string | null;
  description?: string | null;
  lastAmount?: number | null;
  averageAmount?: number | null;
  frequency?: string | null;
  status?: string | null;
}

export interface PriceSpikeAlert {
  id: string;
  merchantName: string;
  frequency: string;
  previousAmount: number;
  currentAmount: number;
  increaseAmount: number;
  percentIncrease: number;
  annualizedImpact: number;
}

const MIN_SPIKE_AMOUNT_DOLLARS = 1.0;
const MIN_SPIKE_PERCENTAGE = 4.0;

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function multiplierForFrequency(frequency?: string | null): number {
  switch (frequency?.toUpperCase().replaceAll("-", "_")) {
    case "WEEKLY":
      return 52;
    case "BIWEEKLY":
    case "BI_WEEKLY":
      return 26;
    case "MONTHLY":
      return 12;
    case "QUARTERLY":
      return 4;
    case "SEMI_MONTHLY":
      return 24;
    case "ANNUALLY":
    case "YEARLY":
      return 1;
    default:
      return 12; // default to monthly assumption
  }
}

/**
 * Detects subscription price hikes by comparing recent charge amount against baseline average.
 */
export function detectPriceSpikes(
  streams: RecurringStreamCandidate[],
): PriceSpikeAlert[] {
  const alerts: PriceSpikeAlert[] = [];

  for (const s of streams) {
    if (s.status === "inactive") continue;

    const current = Math.abs(Number(s.lastAmount) || 0);
    const baseline = Math.abs(Number(s.averageAmount) || 0);

    if (current <= 0 || baseline <= 0) continue;

    const increase = round2(current - baseline);
    if (increase < MIN_SPIKE_AMOUNT_DOLLARS) continue;

    const pct = round2((increase / baseline) * 100);
    if (pct < MIN_SPIKE_PERCENTAGE) continue;

    const freq = s.frequency?.toLowerCase() || "monthly";
    const multiplier = multiplierForFrequency(s.frequency);
    const annualized = round2(increase * multiplier);

    const name = s.merchantName?.trim() || s.description?.trim() || "Subscription";

    alerts.push({
      id: s.id,
      merchantName: name,
      frequency: freq,
      previousAmount: baseline,
      currentAmount: current,
      increaseAmount: increase,
      percentIncrease: pct,
      annualizedImpact: annualized,
    });
  }

  // Sort by highest annualized impact first
  return alerts.sort((a, b) => b.annualizedImpact - a.annualizedImpact);
}

/**
 * Calculates total annual extra cost across all detected price hikes.
 */
export function totalAnnualPriceHikeImpact(alerts: PriceSpikeAlert[]): number {
  return round2(alerts.reduce((acc, a) => acc + a.annualizedImpact, 0));
}
