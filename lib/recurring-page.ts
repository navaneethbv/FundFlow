export type RecurringFrequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "SEMI_MONTHLY"
  | "MONTHLY"
  | "ANNUALLY"
  | "UNKNOWN";

export type RecurringStreamStatus = "MATURE" | "EARLY_DETECTION" | "TOMBSTONED" | "UNKNOWN";

interface Cadence {
  unit: "days" | "months";
  amount: number;
}

const PLAID_CADENCE: Record<RecurringFrequency, Cadence> = {
  WEEKLY: { unit: "days", amount: 7 },
  BIWEEKLY: { unit: "days", amount: 14 },
  SEMI_MONTHLY: { unit: "days", amount: 15 },
  MONTHLY: { unit: "months", amount: 1 },
  ANNUALLY: { unit: "months", amount: 12 },
  UNKNOWN: { unit: "months", amount: 1 },
};

const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  WEEKLY: "Every week",
  BIWEEKLY: "Every 2 weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Every month",
  ANNUALLY: "Every year",
  UNKNOWN: "Recurring",
};

function parseDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const next = parseDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return isoDate(next);
}

function addMonths(date: string, months: number): string {
  const next = parseDate(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return isoDate(next);
}

function step(date: string, cadence: Cadence, direction: 1 | -1): string {
  if (cadence.unit === "days") return addDays(date, cadence.amount * direction);
  return addMonths(date, cadence.amount * direction);
}

/** Bounded so a corrupt or far-future anchor can never loop forever. */
const MAX_STEPS = 600;

/**
 * Every occurrence date in `[windowStart, windowEndExclusive)` reachable
 * from `anchor` by stepping at `cadence`'s pace, in either direction. Used
 * for both Plaid streams (whose anchor is usually a future predicted date)
 * and manual items (whose anchor is a user-entered next-due date).
 */
export function occurrenceDatesInWindow(
  anchor: string,
  cadence: Cadence,
  windowStart: string,
  windowEndExclusive: string,
): string[] {
  let cursor = anchor;
  for (let i = 0; i < MAX_STEPS && cursor >= windowStart; i++) {
    cursor = step(cursor, cadence, -1);
  }
  const dates: string[] = [];
  for (let i = 0; i < MAX_STEPS && cursor < windowEndExclusive; i++) {
    cursor = step(cursor, cadence, 1);
    if (cursor >= windowStart && cursor < windowEndExclusive) dates.push(cursor);
  }
  return dates;
}
