export type RecurringFrequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "SEMI_MONTHLY"
  | "MONTHLY"
  | "ANNUALLY"
  | "UNKNOWN";

export type RecurringStreamStatus = "MATURE" | "EARLY_DETECTION" | "TOMBSTONED" | "UNKNOWN";

export interface RecurringStreamInput {
  id: string;
  streamType: "inflow" | "outflow";
  merchantName: string | null;
  description: string | null;
  averageAmount: number | null;
  lastAmount: number | null;
  userAmount: number | null;
  frequency: RecurringFrequency;
  status: RecurringStreamStatus;
  isActive: boolean;
  accountName: string | null;
  isCreditAccount: boolean;
  firstDate: string | null;
  lastDate: string | null;
  predictedNextDate: string | null;
  reviewedAt: string | null;
  dismissedAt: string | null;
  matchedTransactions: { id: string; date: string }[];
}

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

export function countUnreviewedStreams(
  streams: Pick<RecurringStreamInput, "isActive" | "status" | "dismissedAt" | "reviewedAt">[],
): number {
  return streams.filter(
    (stream) =>
      stream.isActive &&
      stream.status === "MATURE" &&
      !stream.dismissedAt &&
      !stream.reviewedAt,
  ).length;
}

export type ManualRecurringFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export interface ManualRecurringItemInput {
  id: string;
  name: string;
  amount: number;
  frequency: ManualRecurringFrequency;
  nextDate: string;
  itemType: "income" | "expense";
  category: string | null;
  enabled: boolean;
}

export interface RecurringOccurrence {
  source: "plaid" | "manual";
  sourceId: string;
  merchant: string;
  frequency: string;
  dueDate: string;
  account: string | null;
  category: string | null;
  amount: number;
  status: "upcoming" | "overdue" | "complete";
  matchedTransactionId: string | null;
  isIncome: boolean;
}

export interface RecurringMonth {
  month: string;
  occurrences: RecurringOccurrence[];
  totals: {
    income: { paid: number; remaining: number };
    expenses: { paid: number; remaining: number };
    creditCards: { paid: number; remaining: number };
  };
  reviewCount: number;
}

const MANUAL_CADENCE: Record<ManualRecurringFrequency, Cadence> = {
  weekly: { unit: "days", amount: 7 },
  biweekly: { unit: "days", amount: 14 },
  monthly: { unit: "months", amount: 1 },
  quarterly: { unit: "months", amount: 3 },
  yearly: { unit: "months", amount: 12 },
};

const MANUAL_FREQUENCY_LABELS: Record<ManualRecurringFrequency, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
  quarterly: "Every quarter",
  yearly: "Every year",
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toleranceDays(frequency: RecurringFrequency): number {
  return frequency === "WEEKLY" || frequency === "BIWEEKLY" ? 5 : 10;
}

function dayDiff(a: string, b: string): number {
  return (parseDate(a).getTime() - parseDate(b).getTime()) / 86_400_000;
}

function nearestMatch(
  dueDate: string,
  matches: { id: string; date: string }[],
  tolerance: number,
): { id: string; date: string } | null {
  const lower = addDays(dueDate, -tolerance);
  const upper = addDays(dueDate, tolerance);
  const inRange = matches.filter((match) => match.date >= lower && match.date <= upper);
  if (inRange.length === 0) return null;
  return inRange.toSorted(
    (a, b) => Math.abs(dayDiff(a.date, dueDate)) - Math.abs(dayDiff(b.date, dueDate)),
  )[0]!;
}

interface Bucket {
  paid: number;
  remaining: number;
}

function addToBucket(bucket: Bucket, amount: number, complete: boolean): void {
  if (complete) bucket.paid = round2(bucket.paid + amount);
  else bucket.remaining = round2(bucket.remaining + amount);
}

export function expandStreamsForMonth(
  streams: RecurringStreamInput[],
  manualItems: ManualRecurringItemInput[],
  month: string,
  today: string,
): RecurringMonth {
  const windowStart = `${month}-01`;
  const windowEndExclusive = addMonths(windowStart, 1);
  const occurrences: RecurringOccurrence[] = [];
  const totals = {
    income: { paid: 0, remaining: 0 },
    expenses: { paid: 0, remaining: 0 },
    creditCards: { paid: 0, remaining: 0 },
  };

  for (const stream of streams) {
    if (stream.dismissedAt || stream.status === "TOMBSTONED" || !stream.isActive) continue;
    const anchor = stream.predictedNextDate ?? stream.lastDate ?? stream.firstDate;
    if (!anchor) continue;

    const cadence = PLAID_CADENCE[stream.frequency];
    const tolerance = toleranceDays(stream.frequency);
    const dueDates = occurrenceDatesInWindow(anchor, cadence, windowStart, windowEndExclusive);
    const amount = Math.abs(stream.userAmount ?? stream.averageAmount ?? stream.lastAmount ?? 0);
    const isIncome = stream.streamType === "inflow";
    // A working pool consumed as due dates match, so one transaction can
    // complete at most one occurrence per stream. Without this, adjacent due
    // dates whose tolerance windows overlap (WEEKLY: 2*5 > 7; SEMI_MONTHLY:
    // 2*10 > 15) would double-count the same transaction.
    const availableMatches = [...stream.matchedTransactions];

    for (const dueDate of dueDates) {
      const match = nearestMatch(dueDate, availableMatches, tolerance);
      if (match) {
        const consumedIndex = availableMatches.findIndex((candidate) => candidate.id === match.id);
        if (consumedIndex !== -1) availableMatches.splice(consumedIndex, 1);
      }
      const complete = match !== null;
      occurrences.push({
        source: "plaid",
        sourceId: stream.id,
        merchant: stream.merchantName ?? stream.description ?? "Unknown",
        frequency: FREQUENCY_LABELS[stream.frequency],
        dueDate,
        account: stream.accountName,
        category: null,
        amount,
        status: complete ? "complete" : dueDate < today ? "overdue" : "upcoming",
        matchedTransactionId: match?.id ?? null,
        isIncome,
      });
      // isIncome is checked first intentionally: a credit-card refund/payment
      // modeled as an inflow should count as income, not reduce the
      // credit-card bucket, even when isCreditAccount is also true.
      if (isIncome) addToBucket(totals.income, amount, complete);
      else if (stream.isCreditAccount) addToBucket(totals.creditCards, amount, complete);
      else addToBucket(totals.expenses, amount, complete);
    }
  }

  for (const item of manualItems) {
    if (!item.enabled) continue;
    const cadence = MANUAL_CADENCE[item.frequency];
    const dueDates = occurrenceDatesInWindow(item.nextDate, cadence, windowStart, windowEndExclusive);
    const amount = Math.abs(item.amount);
    const isIncome = item.itemType === "income";

    for (const dueDate of dueDates) {
      const complete = false; // Manual items have no linked transaction to confirm against.
      occurrences.push({
        source: "manual",
        sourceId: item.id,
        merchant: item.name,
        frequency: MANUAL_FREQUENCY_LABELS[item.frequency],
        dueDate,
        account: null,
        category: item.category,
        amount,
        status: dueDate < today ? "overdue" : "upcoming",
        matchedTransactionId: null,
        isIncome,
      });
      if (isIncome) addToBucket(totals.income, amount, complete);
      else addToBucket(totals.expenses, amount, complete);
    }
  }

  occurrences.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.merchant.localeCompare(b.merchant),
  );

  return {
    month,
    occurrences,
    totals,
    reviewCount: countUnreviewedStreams(streams),
  };
}
