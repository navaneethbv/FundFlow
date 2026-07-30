import type { CashFlowForecast, ForecastInput, RecurringItem, RecurringFrequency } from '@/lib/planning';

/**
 * Monte-Carlo-lite cash-flow projection.
 * Runs `runs` simulations applying random noise (±jitter %) to recurring amounts
 * and returns the median-path forecast.
 */
export function runMonteCarloForecast(
  input: ForecastInput,
  runs = 200,
  jitter = 0.1,
): CashFlowForecast {
  const { startingBalance, asOf, horizonDays, items, lowBalanceThreshold } = input;
  const start = new Date(asOf);
  const balance0 = startingBalance ?? 0;

  // Collect lowest-balance across runs
  const lowestPerRun: number[] = [];
  const finalPerRun: number[] = [];

  for (let r = 0; r < runs; r++) {
    let bal = balance0;
    let low = bal;
    const events = expandEvents(items, start, horizonDays, jitter);
    for (const ev of events) {
      bal += ev.amount;
      if (bal < low) low = bal;
    }
    lowestPerRun.push(low);
    finalPerRun.push(bal);
  }

  lowestPerRun.sort((a, b) => a - b);
  finalPerRun.sort((a, b) => a - b);
  const medianIdx = Math.floor(runs / 2);

  const deterministicEvents = expandEvents(items, start, horizonDays, 0);
  let detBal = balance0;
  const eventList = deterministicEvents.map((ev) => {
    detBal += ev.amount;
    return { ...ev, projectedBalance: Math.round(detBal * 100) / 100 };
  });

  const lowestBalance = Math.round(lowestPerRun[medianIdx]! * 100) / 100;
  const projectedBalance = Math.round(finalPerRun[medianIdx]! * 100) / 100;
  const lowBalanceRisk = lowestBalance < lowBalanceThreshold;

  return {
    projectedBalance,
    lowBalanceRisk,
    lowestBalance,
    assumptions: [
      `${runs} Monte-Carlo runs, ±${Math.round(jitter * 100)}% jitter.`,
      `Horizon: ${horizonDays} days from ${asOf}.`,
    ],
    events: eventList,
  };
}

/* ---------- helpers ---------- */

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function freqDays(f: RecurringFrequency): number {
  switch (f) {
    case 'weekly':
      return 7;
    case 'biweekly':
      return 14;
    case 'monthly':
      return 30;
    case 'quarterly':
      return 91;
    case 'yearly':
      return 365;
  }
}

interface SimpleEvent {
  date: string;
  name: string;
  amount: number;
  itemType: 'income' | 'expense';
}

function expandEvents(
  items: RecurringItem[],
  start: Date,
  horizonDays: number,
  jitter: number,
): SimpleEvent[] {
  const end = addDays(start, horizonDays);
  const events: SimpleEvent[] = [];
  for (const item of items) {
    let cursor = new Date(item.nextDate);
    const step = freqDays(item.frequency);
    while (cursor <= end) {
      if (cursor >= start) {
        const noise = 1 + (Math.random() * 2 - 1) * jitter;
        const rawAmt = item.amount * noise;
        const signed = item.itemType === 'expense' ? -Math.abs(rawAmt) : Math.abs(rawAmt);
        events.push({
          date: cursor.toISOString().slice(0, 10),
          name: item.name,
          amount: Math.round(signed * 100) / 100,
          itemType: item.itemType,
        });
      }
      cursor = addDays(cursor, step);
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}
