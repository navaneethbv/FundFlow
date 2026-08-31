import { createHash } from "node:crypto";
import { addDays, parseDate } from "@/lib/date-utils";

export const RECURRING_DETECTION_VERSION = 1;

export type DetectedRecurringFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY";
export type RecurringIdentityFrequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "SEMI_MONTHLY"
  | "ANNUALLY"
  | "UNKNOWN";
export type RecurringAmountPattern = "fixed" | "price_step" | "variable";
type StreamType = "inflow" | "outflow";

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
  streamType: StreamType;
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

const CADENCES = [
  { frequency: "WEEKLY", historyDays: 56, required: 8, minimumGap: 6, maximumGap: 8, nominalGap: 7 },
  { frequency: "BIWEEKLY", historyDays: 56, required: 4, minimumGap: 12, maximumGap: 16, nominalGap: 14 },
  { frequency: "MONTHLY", historyDays: 124, required: 3, minimumGap: 26, maximumGap: 35, nominalGap: 30 },
  { frequency: "QUARTERLY", historyDays: 310, required: 3, minimumGap: 80, maximumGap: 100, nominalGap: 91 },
] as const;

const RECURRING_SIGNIFIERS = [
  "AUTOPAY",
  "AUTO PAY",
  "SUB",
  "SUBSCRIPTION",
  "MEMBERSHIP",
  "RECURRING",
  "BILL PAY",
  "DIRECT DEBIT",
] as const;

const VARIABLE_BILL_CATEGORY_TOKENS = new Set([
  "UTILITY",
  "UTILITIES",
  "BILL",
  "BILLS",
  "RENT",
  "MORTGAGE",
  "INSURANCE",
  "ELECTRIC",
  "ELECTRICITY",
  "WATER",
  "INTERNET",
  "CABLE",
]);
const REFERENCE_LABELS = new Set(["REF", "ID", "CARD", "ACCT"]);

interface PreparedTransaction extends RecurringDetectionTransaction {
  effectiveDate: string;
  normalizedMerchant: string;
  currencyKey: string;
}

interface QualifiedAmounts {
  pattern: RecurringAmountPattern;
  expectedAmount: number;
  averageAmount: number;
  strength: number;
}

interface RankedCandidate {
  candidate: DetectedRecurringCandidate;
  cadenceDeviation: number;
  amountStrength: number;
  latestEffectiveDate: string;
}

function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDate(value);
  return parsed.toISOString().slice(0, 10) === value;
}

function dayDifference(earlier: string, later: string): number {
  return Math.round((parseDate(later).getTime() - parseDate(earlier).getTime()) / 86_400_000);
}

function addMonthsClamped(value: string, months: number): string {
  const date = parseDate(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function isAsciiDigits(value: string, minimumLength: number): boolean {
  if (value.length < minimumLength) return false;
  for (const character of value) {
    if (character < "0" || character > "9") return false;
  }
  return true;
}

function isMaskedNumericToken(value: string): boolean {
  let maskLength = 0;
  while (value[maskLength] === "X" || value[maskLength] === "*") maskLength += 1;
  return maskLength >= 2 && isAsciiDigits(value.slice(maskLength), 2);
}

function stripMaskedNumericTokens(value: string): string {
  return value
    .split(/\s+/u)
    .filter((token) => !isMaskedNumericToken(token))
    .join(" ");
}

function stripLabeledReferenceTokens(value: string): string {
  const tokens = value.split(/\s+/u);
  const kept: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token && next && REFERENCE_LABELS.has(token) && isAsciiDigits(next, 3)) {
      index += 1;
      continue;
    }
    if (token) kept.push(token);
  }
  return kept.join(" ");
}

/** Returns a conservative identity, retaining meaningful merchant words. */
export function normalizeRecurringMerchant(value: string): string {
  const normalized = value
    .replace(/[™®]/gu, " ")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/gu, " ")
    .replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/gu, " ")
    .replaceAll("#", " ");
  return stripLabeledReferenceTokens(stripMaskedNumericTokens(normalized)
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function hashIdentity(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

export function recurringIdentityKey(
  userId: string,
  accountId: string,
  streamType: StreamType,
  merchant: string,
  frequency: RecurringIdentityFrequency,
): string;
export function recurringIdentityKey(input: {
  userId: string;
  accountId: string;
  streamType: StreamType;
  merchant: string;
  frequency: RecurringIdentityFrequency;
}): string;
export function recurringIdentityKey(
  userIdOrInput:
    | string
    | { userId: string; accountId: string; streamType: StreamType; merchant: string; frequency: RecurringIdentityFrequency },
  accountId?: string,
  streamType?: StreamType,
  merchant?: string,
  frequency?: RecurringIdentityFrequency,
): string {
  const input = typeof userIdOrInput === "string"
    ? { userId: userIdOrInput, accountId: accountId ?? "", streamType: streamType ?? "outflow", merchant: merchant ?? "", frequency: frequency ?? "MONTHLY" }
    : userIdOrInput;
  const digest = hashIdentity([
    `recurring-v${RECURRING_DETECTION_VERSION}`,
    input.userId,
    input.accountId,
    input.streamType,
    normalizeRecurringMerchant(input.merchant),
    input.frequency,
  ]);
  return `recurring-v${RECURRING_DETECTION_VERSION}:${digest}`;
}

function matchedSignifiers(rows: readonly PreparedTransaction[]): string[] {
  const text = rows.flatMap((row) => [row.merchant, row.rawName ?? ""]).map(normalizedText).join(" ");
  const padded = ` ${text} `;
  return RECURRING_SIGNIFIERS.filter((signifier) => padded.includes(` ${signifier} `));
}

function hasUtilityOrBillCategory(rows: readonly PreparedTransaction[]): boolean {
  return rows.some((row) => normalizedText(`${row.category ?? ""} ${row.detailedCategory ?? ""}`)
    .split(" ")
    .some((token) => VARIABLE_BILL_CATEGORY_TOKENS.has(token)));
}

function isInStore(row: PreparedTransaction): boolean {
  return normalizedText(row.paymentChannel ?? "") === "IN STORE";
}

function steppedAmount(values: readonly number[]): number | null {
  const original = values[0];
  const transitionIndex = values.findIndex((value) => value !== original);
  if (transitionIndex <= 0) return null;
  const changed = values[transitionIndex];
  if (changed === undefined) return null;
  return values.slice(transitionIndex).every((value) => value === changed)
    ? changed / 100
    : null;
}

function qualifyAmounts(rows: readonly PreparedTransaction[], signifiers: readonly string[]): QualifiedAmounts | null {
  const values = rows.map((row) => cents(row.amount));
  const first = values[0];
  const allEqual = values.every((value) => value === first);
  const priceStepAmount = steppedAmount(values);
  const amounts = values.map((value) => value / 100);
  const averageAmount = roundCents(amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length);

  if (allEqual) {
    return { pattern: "fixed", expectedAmount: amounts.at(-1) ?? 0, averageAmount, strength: 3 };
  }
  if (priceStepAmount !== null) {
    return { pattern: "price_step", expectedAmount: priceStepAmount, averageAmount, strength: 2 };
  }

  if (rows.some(isInStore) || (!hasUtilityOrBillCategory(rows) && signifiers.length === 0)) return null;
  const sorted = [...amounts].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
  if (amounts.some((amount) => amount < median / 2.5 || amount > median * 2.5)) return null;
  return { pattern: "variable", expectedAmount: roundCents(median), averageAmount, strength: 1 };
}

function groupKey(row: PreparedTransaction): string {
  return [row.userId, row.plaidItemId, row.accountId, row.flow, row.currencyKey, row.normalizedMerchant].join("\u001f");
}

function transactionOrder(a: PreparedTransaction, b: PreparedTransaction): number {
  return a.effectiveDate.localeCompare(b.effectiveDate)
    || a.postedDate.localeCompare(b.postedDate)
    || a.id.localeCompare(b.id);
}

function buildCandidate(
  rows: readonly PreparedTransaction[],
  cadence: (typeof CADENCES)[number],
): RankedCandidate | null {
  if (rows.length < cadence.required) return null;
  const signifiers = matchedSignifiers(rows);
  const amounts = qualifyAmounts(rows, signifiers);
  if (!amounts) return null;
  const newest = rows.at(-1);
  const oldest = rows[0];
  if (!newest || !oldest) return null;

  const streamType: StreamType = newest.flow === "income" ? "inflow" : "outflow";
  const identityKey = recurringIdentityKey(
    newest.userId,
    newest.accountId,
    streamType,
    newest.normalizedMerchant,
    cadence.frequency,
  );
  const maximumCadenceDeviationDays = rows.slice(1).reduce((maximum, row, index) => {
    const previous = rows[index];
    const deviation = Math.abs(dayDifference(previous!.effectiveDate, row.effectiveDate) - cadence.nominalGap);
    return Math.max(maximum, deviation);
  }, 0);
  const predictedNextDate = nextDateForCadence(newest.effectiveDate, cadence.frequency);
  const merchantName = newest.merchant.trim() || newest.rawName?.trim() || newest.normalizedMerchant;
  const description = newest.rawName?.trim() || merchantName;
  const category = newest.category ?? newest.detailedCategory ?? oldest.category ?? oldest.detailedCategory ?? null;
  const candidate: DetectedRecurringCandidate = {
    streamId: identityKey.replace(/^recurring-v\d+:/u, "inferred:"),
    identityKey,
    plaidItemId: newest.plaidItemId,
    accountId: newest.accountId,
    streamType,
    merchantName,
    description,
    frequency: cadence.frequency,
    amountPattern: amounts.pattern,
    expectedAmount: amounts.expectedAmount,
    averageAmount: amounts.averageAmount,
    lastAmount: roundCents(newest.amount),
    firstDate: oldest.postedDate,
    lastDate: newest.postedDate,
    predictedNextDate,
    category,
    transactionIds: rows.map((row) => row.id),
    evidence: {
      occurrenceCount: rows.length,
      amountPattern: amounts.pattern,
      maximumCadenceDeviationDays,
      matchedSignifiers: signifiers,
    },
  };
  return {
    candidate,
    cadenceDeviation: maximumCadenceDeviationDays,
    amountStrength: amounts.strength,
    latestEffectiveDate: newest.effectiveDate,
  };
}

function compareRankedCandidates(a: RankedCandidate, b: RankedCandidate): number {
  return b.candidate.evidence.occurrenceCount - a.candidate.evidence.occurrenceCount
    || a.cadenceDeviation - b.cadenceDeviation
    || b.amountStrength - a.amountStrength
    || a.candidate.transactionIds.join("\u001f").localeCompare(b.candidate.transactionIds.join("\u001f"));
}

function nextDateForCadence(
  effectiveDate: string,
  frequency: DetectedRecurringFrequency,
): string {
  switch (frequency) {
    case "WEEKLY":
      return addDays(effectiveDate, 7);
    case "BIWEEKLY":
      return addDays(effectiveDate, 14);
    case "MONTHLY":
      return addMonthsClamped(effectiveDate, 1);
    case "QUARTERLY":
      return addMonthsClamped(effectiveDate, 3);
  }
}

function prepareTransactions(
  transactions: readonly RecurringDetectionTransaction[],
  today: string,
): PreparedTransaction[] {
  return transactions
    .filter((row) => row.id && row.userId && row.plaidItemId && row.accountId && row.flow !== undefined)
    .filter((row) => isIsoDate(row.postedDate) && (row.authorizedDate === null || isIsoDate(row.authorizedDate)))
    .filter((row) => row.postedDate <= today && Number.isFinite(row.amount) && row.amount > 0)
    .map((row): PreparedTransaction | null => {
      const merchant = row.merchant.trim() || row.rawName?.trim() || "";
      const normalizedMerchant = normalizeRecurringMerchant(merchant);
      if (!normalizedMerchant) return null;
      return {
        ...row,
        effectiveDate: row.authorizedDate ?? row.postedDate,
        normalizedMerchant,
        currencyKey: row.currency?.trim().toUpperCase() ?? "",
      };
    })
    .filter((row): row is PreparedTransaction => row !== null)
    .sort(transactionOrder);
}

function groupPreparedTransactions(
  prepared: readonly PreparedTransaction[],
): PreparedTransaction[][] {
  const uniqueById = new Map<string, PreparedTransaction>();
  for (const row of prepared) {
    if (!uniqueById.has(row.id)) uniqueById.set(row.id, row);
  }
  const groups = new Map<string, PreparedTransaction[]>();
  for (const row of uniqueById.values()) {
    const key = groupKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function latestCandidateForCadence(
  group: readonly PreparedTransaction[],
  cadence: (typeof CADENCES)[number],
  today: string,
): RankedCandidate | null {
  const historyStart = addDays(today, -cadence.historyDays);
  const inWindow = group.filter((row) => row.effectiveDate >= historyStart && row.effectiveDate <= today);
  if (inWindow.length < cadence.required) return null;

  let segmentStart = 0;
  let latestComplete: RankedCandidate | null = null;
  const considerSegment = (segmentEnd: number) => {
    let windowStart = segmentStart;
    while (
      windowStart < segmentEnd - 1
      && dayDifference(inWindow[windowStart]!.effectiveDate, inWindow[segmentEnd - 1]!.effectiveDate) > cadence.historyDays
    ) {
      windowStart += 1;
    }
    const segment = inWindow.slice(windowStart, segmentEnd);
    if (segment.length < cadence.required) return;
    const result = buildCandidate(segment, cadence);
    if (!result) return;
    const newest = segment.at(-1)!;
    if (!latestComplete || newest.effectiveDate > latestComplete.latestEffectiveDate) latestComplete = result;
  };

  for (let index = 1; index < inWindow.length; index += 1) {
    const previous = inWindow[index - 1]!;
    const current = inWindow[index]!;
    const gap = dayDifference(previous.effectiveDate, current.effectiveDate);
    if (gap < cadence.minimumGap || gap > cadence.maximumGap) {
      considerSegment(index);
      segmentStart = index;
    }
  }
  considerSegment(inWindow.length);
  return latestComplete;
}

function rankedCandidatesForGroup(
  group: readonly PreparedTransaction[],
  today: string,
): RankedCandidate[] {
  return CADENCES.flatMap((cadence) => {
    const candidate = latestCandidateForCadence(group, cadence, today);
    return candidate ? [candidate] : [];
  });
}

function selectCandidatesWithoutReusedTransactions(
  ranked: readonly RankedCandidate[],
): DetectedRecurringCandidate[] {
  const usedTransactionIds = new Set<string>();
  return ranked.flatMap(({ candidate }) => {
    if (candidate.transactionIds.some((id) => usedTransactionIds.has(id))) return [];
    candidate.transactionIds.forEach((id) => usedTransactionIds.add(id));
    return [candidate];
  });
}

/** Detects stable, local recurring patterns from already-filtered canonical rows. */
export function detectRecurringCandidates(
  transactions: readonly RecurringDetectionTransaction[],
  today: string,
): DetectedRecurringCandidate[] {
  if (!isIsoDate(today)) return [];
  const groups = groupPreparedTransactions(prepareTransactions(transactions, today));
  const ranked = groups.flatMap((group) => rankedCandidatesForGroup(group, today));
  ranked.sort(compareRankedCandidates);
  return selectCandidatesWithoutReusedTransactions(ranked);
}
