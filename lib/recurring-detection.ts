import { createHash } from "node:crypto";
import { addMonths, addDays } from "@/lib/date-utils";

export const RECURRING_DETECTION_VERSION = 1;

export type DetectedRecurringFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY";
export type RecurringAmountPattern = "fixed" | "price_step" | "variable";

export interface RecurringDetectionTransaction {
  id: string;
  userId: string;
  plaidItemId: string;
  accountId: string;
  postedDate: string;
  authorizedDate: string | null;
  amount: number;
  flow: "income" | "expense";
  merchant: string;
  rawName: string | null;
  category: string | null;
  detailedCategory: string | null;
  paymentChannel: string | null;
  currency: string | null;
}

export interface DetectedRecurringCandidate {
  streamId: string;
  identityKey: string;
  plaidItemId: string;
  accountId: string;
  streamType: "inflow" | "outflow";
  merchantName: string;
  description: string;
  frequency: DetectedRecurringFrequency;
  amountPattern: RecurringAmountPattern;
  expectedAmount: number;
  averageAmount: number;
  lastAmount: number;
  firstDate: string;
  lastDate: string;
  predictedNextDate: string;
  category: string | null;
  transactionIds: string[];
  evidence: {
    occurrenceCount: number;
    amountPattern: RecurringAmountPattern;
    maximumCadenceDeviationDays: number;
    matchedSignifiers: string[];
  };
}

interface CadenceProfile {
  frequency: DetectedRecurringFrequency;
  /** How far back from today a qualifying sequence may reach. */
  historyDays: number;
  required: number;
  minimumGap: number;
  maximumGap: number;
  /** Interval used for deviation scoring and next-date prediction. */
  stepDays: number;
  stepMonths: number;
  /** Typical interval in days, the baseline for deviation scoring. */
  idealDays: number;
}

const CADENCES: readonly CadenceProfile[] = [
  { frequency: "WEEKLY", historyDays: 56, required: 8, minimumGap: 6, maximumGap: 8, stepDays: 7, stepMonths: 0, idealDays: 7 },
  { frequency: "BIWEEKLY", historyDays: 56, required: 4, minimumGap: 12, maximumGap: 16, stepDays: 14, stepMonths: 0, idealDays: 14 },
  { frequency: "MONTHLY", historyDays: 124, required: 3, minimumGap: 26, maximumGap: 35, stepDays: 0, stepMonths: 1, idealDays: 30 },
  { frequency: "QUARTERLY", historyDays: 310, required: 3, minimumGap: 80, maximumGap: 100, stepDays: 0, stepMonths: 3, idealDays: 90 },
];

/**
 * Recurring text that strengthens a variable candidate. A signifier can never
 * replace the merchant, occurrence, or cadence requirements; it only unlocks
 * the variable amount pattern or a discretionary merchant's variable rule.
 */
const RECURRING_SIGNIFIERS: readonly string[] = [
  "AUTOPAY",
  "AUTO PAY",
  "SUB",
  "SUBSCRIPTION",
  "MEMBERSHIP",
  "RECURRING",
  "BILL PAY",
  "DIRECT DEBIT",
];

/** PFC primaries treated as utility or bill-like for the variable pattern. */
const UTILITY_OR_BILL_CATEGORIES = new Set(["UTILITIES", "TELECOM", "RENT"]);

/**
 * Discretionary primaries: without an explicit signifier they never qualify
 * as variable, and an in-store channel disqualifies them entirely.
 */
const DISCRETIONARY_CATEGORIES = new Set(["FOOD_AND_DRINK", "SHOPPING", "TRANSPORTATION"]);

/** Conservative, deterministic merchant identity normalization. */
export function normalizeRecurringMerchant(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\b(?:REF|ID|CARD|ACCT)\s*\d{3,}\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** SHA-256 identity hash: user, account, direction, merchant, cadence. */
export function recurringIdentityKey(input: {
  userId: string;
  accountId: string;
  streamType: "inflow" | "outflow";
  merchantIdentity: string;
  frequency: DetectedRecurringFrequency;
}): string {
  return createHash("sha256")
    .update(
      [
        "recurring-v1",
        input.userId,
        input.accountId,
        input.streamType,
        input.merchantIdentity,
        input.frequency,
      ].join("|"),
    )
    .digest("hex");
}

function matchedSignifiersFor(texts: readonly (string | null)[]): string[] {
  const haystack = texts
    .filter((text): text is string => Boolean(text))
    .join(" ")
    .toUpperCase();
  return RECURRING_SIGNIFIERS.filter((signifier) => haystack.includes(signifier));
}

function isUtilityOrBillCategory(
  transaction: RecurringDetectionTransaction,
): boolean {
  const primaries = [transaction.category, transaction.detailedCategory]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toUpperCase());
  return primaries.some(
    (value) =>
      UTILITY_OR_BILL_CATEGORIES.has(value) ||
      value.includes("UTILITY") ||
      value.includes("BILL"),
  );
}

function isDiscretionary(transaction: RecurringDetectionTransaction): boolean {
  return [transaction.category, transaction.detailedCategory]
    .filter((value): value is string => Boolean(value))
    .some((value) => DISCRETIONARY_CATEGORIES.has(value.toUpperCase()));
}

interface Occurrence {
  transaction: RecurringDetectionTransaction;
  /** authorizedDate ?? postedDate, the date cadence is measured on. */
  cadenceDate: string;
  amount: number;
}

interface MerchantGroup {
  userId: string;
  plaidItemId: string;
  accountId: string;
  streamType: "inflow" | "outflow";
  currency: string | null;
  merchantDisplay: string;
  merchantIdentity: string;
  occurrences: Occurrence[];
}

function groupKeyFor(transaction: RecurringDetectionTransaction): string {
  return [
    transaction.userId,
    transaction.accountId,
    transaction.flow,
    transaction.currency ?? "",
  ].join("|");
}

/**
 * Builds per-merchant groups inside one (user, account, direction, currency)
 * partition. An empty normalized identity is never eligible.
 */
function buildMerchantGroups(
  transactions: readonly RecurringDetectionTransaction[],
): Map<string, MerchantGroup[]> {
  const partitions = new Map<string, Map<string, MerchantGroup>>();
  for (const transaction of transactions) {
    if (transaction.amount <= 0) continue;
    const merchantIdentity = normalizeRecurringMerchant(transaction.merchant);
    if (!merchantIdentity) continue;
    const key = groupKeyFor(transaction);
    let merchants = partitions.get(key);
    if (!merchants) {
      merchants = new Map();
      partitions.set(key, merchants);
    }
    let group = merchants.get(merchantIdentity);
    if (!group) {
      group = {
        userId: transaction.userId,
        plaidItemId: transaction.plaidItemId,
        accountId: transaction.accountId,
        streamType: transaction.flow === "income" ? "inflow" : "outflow",
        currency: transaction.currency,
        merchantDisplay: transaction.merchant,
        merchantIdentity,
        occurrences: [],
      };
      merchants.set(merchantIdentity, group);
    }
    group.occurrences.push({
      transaction,
      cadenceDate: transaction.authorizedDate ?? transaction.postedDate,
      amount: round2(transaction.amount),
    });
  }
  return partitions;
}

const AMOUNT_STRENGTH: Record<RecurringAmountPattern, number> = {
  fixed: 3,
  price_step: 2,
  variable: 1,
};

/**
 * Classifies the sequence's amounts. Fixed and single price step only fail on
 * an in-store channel when the merchant is discretionary; variable needs a
 * utility or bill category or a recurring signifier, rejects in store
 * outright, and rejects any occurrence above 2.5x the sequence median.
 */
function classifyAmountPattern(
  occurrences: readonly Occurrence[],
  signifiers: readonly string[],
): RecurringAmountPattern | null {
  const amounts = occurrences.map((occurrence) => occurrence.amount);
  const channel = occurrences[occurrences.length - 1]!.transaction.paymentChannel;
  const discretionary = occurrences.some((occurrence) => isDiscretionary(occurrence.transaction));
  if (channel === "in store" && (discretionary || signifiers.length === 0)) return null;

  const allFixed = amounts.every((amount) => amount === amounts[0]);
  if (allFixed) return "fixed";

  const older = amounts.slice(0, -1);
  const newest = amounts[amounts.length - 1]!;
  if (older.every((amount) => amount === older[0]) && newest !== older[0]) {
    return "price_step";
  }

  const hasUtilityEvidence =
    occurrences.some((occurrence) => isUtilityOrBillCategory(occurrence.transaction)) ||
    signifiers.length > 0;
  if (!hasUtilityEvidence) return null;
  if (channel === "in store") return null;
  const sequenceMedian = median(amounts);
  if (amounts.some((amount) => amount > 2.5 * sequenceMedian)) return null;
  return "variable";
}

function maximumDeviationDays(
  dates: readonly string[],
  cadence: CadenceProfile,
): number {
  let maximum = 0;
  for (let i = 1; i < dates.length; i += 1) {
    const gap = Math.round(
      (Date.parse(dates[i]!) - Date.parse(dates[i - 1]!)) / 86_400_000,
    );
    const deviation = Math.abs(gap - cadence.idealDays);
    if (deviation > maximum) maximum = deviation;
  }
  return maximum;
}

function predictedNextDate(lastCadenceDate: string, cadence: CadenceProfile): string {
  return cadence.stepMonths > 0
    ? addMonths(lastCadenceDate, cadence.stepMonths)
    : addDays(lastCadenceDate, cadence.stepDays);
}

/**
 * The most recent complete qualifying sequence for one cadence: consecutive
 * occurrences whose adjacent gaps all sit inside the cadence interval, whose
 * total span fits the cadence's history window, and that do not reach into
 * the future. Any out-of-window gap breaks the sequence rather than being
 * ignored, so the run stops at the first bad adjacent pair. A run longer
 * than the window fits is trimmed from the oldest end.
 */
function qualifyingRun(
  occurrences: readonly Occurrence[],
  cadence: CadenceProfile,
  today: string,
): Occurrence[] {
  const current = occurrences.filter((occurrence) => occurrence.cadenceDate <= today);
  const run: Occurrence[] = [];
  for (let i = current.length - 1; i >= 0; i -= 1) {
    const occurrence = current[i]!;
    const next = current[i + 1];
    if (next) {
      const gap = Math.round(
        (Date.parse(next.cadenceDate) - Date.parse(occurrence.cadenceDate)) / 86_400_000,
      );
      if (gap < cadence.minimumGap || gap > cadence.maximumGap) break;
    }
    run.unshift(occurrence);
  }
  if (run.length < cadence.required) return [];
  const spanDays = (last: Occurrence, first: Occurrence): number =>
    (Date.parse(last.cadenceDate) - Date.parse(first.cadenceDate)) / 86_400_000;
  while (
    run.length > cadence.required &&
    spanDays(run[run.length - 1]!, run[0]!) > cadence.historyDays
  ) {
    run.shift();
  }
  if (spanDays(run[run.length - 1]!, run[0]!) > cadence.historyDays) return [];
  return run;
}

function buildCandidate(
  group: MerchantGroup,
  run: readonly Occurrence[],
  cadence: CadenceProfile,
  amountPattern: RecurringAmountPattern,
  signifiers: readonly string[],
): DetectedRecurringCandidate {
  const transactionIds = run.map((occurrence) => occurrence.transaction.id);
  const amounts = run.map((occurrence) => occurrence.amount);
  const lastAmount = amounts[amounts.length - 1]!;
  const expectedAmount =
    amountPattern === "variable" ? round2(median(amounts)) : lastAmount;
  const averageAmount = round2(
    amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length,
  );
  const identityKey = recurringIdentityKey({
    userId: group.userId,
    accountId: group.accountId,
    streamType: group.streamType,
    merchantIdentity: group.merchantIdentity,
    frequency: cadence.frequency,
  });
  const firstOccurrence = run[0]!;
  const lastOccurrence = run[run.length - 1]!;
  return {
    streamId: `inferred:${identityKey}`,
    identityKey,
    plaidItemId: group.plaidItemId,
    accountId: group.accountId,
    streamType: group.streamType,
    merchantName: lastOccurrence.transaction.merchant,
    description: lastOccurrence.transaction.rawName ?? lastOccurrence.transaction.merchant,
    frequency: cadence.frequency,
    amountPattern,
    expectedAmount,
    averageAmount,
    lastAmount,
    firstDate: firstOccurrence.transaction.postedDate,
    lastDate: lastOccurrence.transaction.postedDate,
    predictedNextDate: predictedNextDate(lastOccurrence.cadenceDate, cadence),
    category: lastOccurrence.transaction.category,
    transactionIds,
    evidence: {
      occurrenceCount: run.length,
      amountPattern,
      maximumCadenceDeviationDays: maximumDeviationDays(
        run.map((occurrence) => occurrence.cadenceDate),
        cadence,
      ),
      matchedSignifiers: [...signifiers],
    },
  };
}

/**
 * Detects locally inferred recurring candidates from canonical transactions.
 *
 * Deterministic: groups by user, account, direction, and currency; evaluates
 * every cadence profile per merchant; ranks candidates by occurrence count,
 * cadence deviation, amount strength, and stable transaction ids; and never
 * lets one transaction support two inferred streams in the same pass.
 */
export function detectRecurringCandidates(
  transactions: readonly RecurringDetectionTransaction[],
  today: string,
): DetectedRecurringCandidate[] {
  const partitions = buildMerchantGroups(transactions);
  const candidates: DetectedRecurringCandidate[] = [];
  for (const merchants of partitions.values()) {
    for (const group of merchants.values()) {
      const sorted = [...group.occurrences].sort((a, b) =>
        a.cadenceDate.localeCompare(b.cadenceDate) || a.transaction.id.localeCompare(b.transaction.id),
      );
      for (const cadence of CADENCES) {
        const run = qualifyingRun(sorted, cadence, today);
        if (run.length === 0) continue;
        const signifiers = matchedSignifiersFor([
          ...new Set(run.map((occurrence) => occurrence.transaction.merchant)),
          ...run.map((occurrence) => occurrence.transaction.rawName),
        ]);
        const amountPattern = classifyAmountPattern(run, signifiers);
        if (!amountPattern) continue;
        candidates.push(buildCandidate(group, run, cadence, amountPattern, signifiers));
      }
    }
  }

  candidates.sort((a, b) =>
    b.evidence.occurrenceCount - a.evidence.occurrenceCount ||
    a.evidence.maximumCadenceDeviationDays - b.evidence.maximumCadenceDeviationDays ||
    AMOUNT_STRENGTH[b.amountPattern] - AMOUNT_STRENGTH[a.amountPattern] ||
    a.transactionIds.join(",").localeCompare(b.transactionIds.join(",")),
  );

  const used = new Set<string>();
  const selected: DetectedRecurringCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.transactionIds.some((id) => used.has(id))) continue;
    for (const id of candidate.transactionIds) used.add(id);
    selected.push(candidate);
  }
  return selected;
}
