/**
 * Pure financial-intelligence helpers: essentials/discretionary split,
 * savings-rate series, emergency-fund runway, paycheck detection,
 * safe-to-spend, recurring price-hike diffing, and budget suggestions.
 *
 * Everything here is pure math over data the dashboard already loads —
 * no I/O, no Plaid calls. Amount sign follows Plaid: positive = money out.
 */

/**
 * Primary personal-finance categories treated as essential spending.
 * Transfers and loan payments never reach these helpers (EXCLUDED_PFC in
 * lib/dashboard.ts drops them from spend aggregation upstream).
 */
export const ESSENTIAL_PFC_PRIMARY = new Set([
  "RENT_AND_UTILITIES",
  "MEDICAL",
  "TRANSPORTATION",
  "GOVERNMENT_AND_NON_PROFIT",
  "BANK_FEES",
]);

/** Detailed categories that are essential even though their primary is not. */
export const ESSENTIAL_PFC_DETAILED = new Set([
  "FOOD_AND_DRINK_GROCERIES",
  "GENERAL_SERVICES_INSURANCE",
  "GENERAL_SERVICES_EDUCATION",
]);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface CategorizedSpendRow {
  month: string;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  amount: number;
}

export interface EssentialsSplit {
  month: string;
  essentials: number;
  discretionary: number;
}

export function isEssentialSpend(
  pfcPrimary: string | null,
  pfcDetailed: string | null,
): boolean {
  if (pfcDetailed && ESSENTIAL_PFC_DETAILED.has(pfcDetailed)) return true;
  return pfcPrimary !== null && ESSENTIAL_PFC_PRIMARY.has(pfcPrimary);
}

/** Per-month essentials vs discretionary totals for the given month keys. */
export function splitEssentialsByMonth(
  rows: CategorizedSpendRow[],
  months: string[],
): EssentialsSplit[] {
  const essentials = new Map<string, number>();
  const discretionary = new Map<string, number>();

  for (const row of rows) {
    const bucket = isEssentialSpend(row.pfcPrimary, row.pfcDetailed)
      ? essentials
      : discretionary;
    bucket.set(row.month, (bucket.get(row.month) ?? 0) + row.amount);
  }

  return months.map((month) => ({
    month,
    essentials: round2(essentials.get(month) ?? 0),
    discretionary: round2(discretionary.get(month) ?? 0),
  }));
}

export interface MonthAmount {
  month: string;
  amount: number;
}

export interface SavingsRatePoint {
  month: string;
  /** Whole-percent savings rate, floored at 0 (matches computeSavingsRate). */
  rate: number;
}

/** Per-month savings rate (%): (income − spending) / income, floored at 0. */
export function computeSavingsRateSeries(
  income: MonthAmount[],
  spending: MonthAmount[],
): SavingsRatePoint[] {
  const spendByMonth = new Map(spending.map((row) => [row.month, row.amount]));
  return income.map((row) => {
    const spent = spendByMonth.get(row.month) ?? 0;
    const rate =
      row.amount <= 0 ? 0 : Math.max(0, Math.round(((row.amount - spent) / row.amount) * 100));
    return { month: row.month, rate };
  });
}

/** Median of a non-empty list (callers guard emptiness). */
export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Months of essential spending the liquid balance covers. Zero-essentials
 * months are treated as pre-history gaps and excluded from the median.
 * Returns null when the balance or history is unusable.
 */
export function computeRunwayMonths(input: {
  liquidBalance: number | null;
  monthlyEssentials: number[];
}): number | null {
  if (input.liquidBalance === null) return null;
  const nonZero = input.monthlyEssentials.filter((amount) => amount > 0);
  if (nonZero.length === 0) return null;
  const typicalMonth = medianOf(nonZero);
  if (typicalMonth <= 0) return null;
  return Math.round((input.liquidBalance / typicalMonth) * 10) / 10;
}

export type PayFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export interface IncomeStreamInput {
  name: string;
  amount: number;
  frequency: PayFrequency;
}

export interface IncomeTransactionInput {
  date: string;
  merchant: string;
  amount: number;
}

export interface Paycheck {
  name: string;
  amount: number;
  frequency: PayFrequency;
  /** Latest matching deposit date, or null when no deposit matched. */
  lastPaidDate: string | null;
  /** First cadence date on/after asOf, or null without a deposit anchor. */
  nextPayDate: string | null;
}

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

function advance(date: string, frequency: PayFrequency): string {
  if (frequency === "weekly") return addDays(date, 7);
  if (frequency === "biweekly") return addDays(date, 14);
  if (frequency === "quarterly") return addMonths(date, 3);
  if (frequency === "yearly") return addMonths(date, 12);
  return addMonths(date, 1);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Matches income streams to real deposits to infer each stream's last pay
 * date and next expected pay date. The primary paycheck is the largest
 * stream whose next date is known — unanchored streams are reported but
 * never trusted to drive Safe-to-Spend.
 */
export function detectPaychecks(input: {
  incomeStreams: IncomeStreamInput[];
  incomeTransactions: IncomeTransactionInput[];
  asOf: string;
}): { paychecks: Paycheck[]; primary: Paycheck | null } {
  const paychecks = input.incomeStreams.map((stream) => {
    const target = normalizeName(stream.name);
    let lastPaidDate: string | null = null;
    for (const txn of input.incomeTransactions) {
      if (normalizeName(txn.merchant) !== target) continue;
      if (!lastPaidDate || txn.date > lastPaidDate) lastPaidDate = txn.date;
    }

    let nextPayDate: string | null = null;
    if (lastPaidDate) {
      let cursor = lastPaidDate;
      // Bounded loop: even weekly cadence reaches any realistic asOf fast.
      for (let i = 0; i < 400 && cursor < input.asOf; i++) {
        cursor = advance(cursor, stream.frequency);
      }
      nextPayDate = cursor >= input.asOf ? cursor : null;
    }

    return {
      name: stream.name,
      amount: stream.amount,
      frequency: stream.frequency,
      lastPaidDate,
      nextPayDate,
    };
  });

  const primary =
    paychecks
      .filter((paycheck) => paycheck.nextPayDate !== null)
      .sort((a, b) => b.amount - a.amount)[0] ?? null;

  return { paychecks, primary };
}

/** Days assumed when no paycheck anchors the Safe-to-Spend horizon. */
export const SAFE_TO_SPEND_FALLBACK_DAYS = 14;

export interface UpcomingExpense {
  date: string;
  name: string;
  amount: number;
}

export interface SafeToSpend {
  /** Cash minus bills due in the horizon. Negative means overdrawn outlook. */
  amount: number;
  cashBalance: number;
  upcomingBillsTotal: number;
  /** Exclusive end of the bill window (payday replenishes the balance). */
  horizonEnd: string;
  /** "paycheck" when anchored to a detected payday, "window" for the fallback. */
  anchor: "paycheck" | "window";
}

/**
 * What is spendable today: cash minus recurring bills that land on/after
 * asOf and strictly before the next paycheck (or a fallback window when no
 * paycheck is known). Returns null when the cash balance is unknown —
 * a made-up zero here would be worse than no number.
 */
export function computeSafeToSpend(input: {
  cashBalance: number | null;
  asOf: string;
  nextPayDate: string | null;
  upcomingExpenses: UpcomingExpense[];
}): SafeToSpend | null {
  if (input.cashBalance === null) return null;

  const anchor: SafeToSpend["anchor"] = input.nextPayDate ? "paycheck" : "window";
  const horizonEnd =
    input.nextPayDate ?? addDays(input.asOf, SAFE_TO_SPEND_FALLBACK_DAYS);

  let upcomingBillsTotal = 0;
  for (const expense of input.upcomingExpenses) {
    if (expense.date < input.asOf || expense.date >= horizonEnd) continue;
    upcomingBillsTotal += Math.abs(expense.amount);
  }
  upcomingBillsTotal = round2(upcomingBillsTotal);

  return {
    amount: round2(input.cashBalance - upcomingBillsTotal),
    cashBalance: round2(input.cashBalance),
    upcomingBillsTotal,
    horizonEnd,
    anchor,
  };
}

/** A hike must rise by at least $2 or 5% — anything smaller is billing noise. */
const PRICE_HIKE_MIN_INCREASE = 2;
const PRICE_HIKE_MIN_PCT = 5;

export interface PreviousStream {
  streamId: string;
  lastAmount: number | null;
}

export interface NextStream {
  streamId: string;
  streamType: "inflow" | "outflow";
  name: string;
  lastAmount: number | null;
  isActive: boolean;
}

export interface PriceHike {
  streamId: string;
  name: string;
  previousAmount: number;
  newAmount: number;
  increase: number;
  pctIncrease: number;
}

export interface RecurringDiff {
  priceHikes: PriceHike[];
  newStreams: { streamId: string; name: string; amount: number }[];
}

/**
 * Diffs freshly fetched recurring streams against what is already stored.
 * Only active outflow streams matter: inflows are paychecks, and inactive
 * streams are Plaid telling us the subscription already ended.
 */
export function diffRecurringStreams(
  previous: PreviousStream[],
  next: NextStream[],
): RecurringDiff {
  const previousById = new Map(previous.map((row) => [row.streamId, row.lastAmount]));
  const diff: RecurringDiff = { priceHikes: [], newStreams: [] };

  for (const stream of next) {
    if (stream.streamType !== "outflow" || !stream.isActive) continue;
    const newAmount = Math.abs(stream.lastAmount ?? 0);

    if (!previousById.has(stream.streamId)) {
      if (newAmount > 0) {
        diff.newStreams.push({
          streamId: stream.streamId,
          name: stream.name,
          amount: round2(newAmount),
        });
      }
      continue;
    }

    const previousAmount = Math.abs(previousById.get(stream.streamId) ?? 0);
    if (previousAmount <= 0 || newAmount <= previousAmount) continue;
    const increase = round2(newAmount - previousAmount);
    const pctIncrease = Math.round((increase / previousAmount) * 1000) / 10;
    if (increase < PRICE_HIKE_MIN_INCREASE && pctIncrease < PRICE_HIKE_MIN_PCT) continue;

    diff.priceHikes.push({
      streamId: stream.streamId,
      name: stream.name,
      previousAmount: round2(previousAmount),
      newAmount: round2(newAmount),
      increase,
      pctIncrease,
    });
  }

  return diff;
}

/** "2026-07" + delta months, pure string math. */
function addYearMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y! * 12 + (m! - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export interface MerchantDriftItem {
  merchant: string;
  earlierAvg: number;
  recentAvg: number;
  driftPct: number;
}

export interface MerchantPriceDrift {
  items: MerchantDriftItem[];
  /** Recent-spend-weighted average drift across items, or null with none. */
  overallDriftPct: number | null;
}

/**
 * Personal price drift: for merchants charged in both windows, compares the
 * average charge over the recent 3 months vs the 3 months before that.
 * Needs ≥2 charges per side so one odd bill doesn't read as inflation.
 */
export function computeMerchantPriceDrift(input: {
  txns: { date: string; merchant: string; amount: number }[];
  asOfMonth: string;
  minCharges?: number;
}): MerchantPriceDrift {
  const minCharges = input.minCharges ?? 2;
  const recentMonths = new Set([0, -1, -2].map((d) => addYearMonths(input.asOfMonth, d)));
  const earlierMonths = new Set([-3, -4, -5].map((d) => addYearMonths(input.asOfMonth, d)));

  const byMerchant = new Map<string, { name: string; recent: number[]; earlier: number[] }>();
  for (const txn of input.txns) {
    if (txn.amount <= 0) continue;
    const month = txn.date.slice(0, 7);
    const bucket = recentMonths.has(month) ? "recent" : earlierMonths.has(month) ? "earlier" : null;
    if (!bucket) continue;
    const key = normalizeName(txn.merchant);
    const entry = byMerchant.get(key) ?? { name: txn.merchant, recent: [], earlier: [] };
    entry[bucket].push(txn.amount);
    byMerchant.set(key, entry);
  }

  const items: MerchantDriftItem[] = [];
  for (const entry of byMerchant.values()) {
    if (entry.recent.length < minCharges || entry.earlier.length < minCharges) continue;
    const recentAvg = round2(entry.recent.reduce((s, v) => s + v, 0) / entry.recent.length);
    const earlierAvg = round2(entry.earlier.reduce((s, v) => s + v, 0) / entry.earlier.length);
    if (earlierAvg <= 0) continue;
    items.push({
      merchant: entry.name,
      earlierAvg,
      recentAvg,
      driftPct: Math.round(((recentAvg - earlierAvg) / earlierAvg) * 1000) / 10,
    });
  }
  items.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));

  let overallDriftPct: number | null = null;
  if (items.length > 0) {
    let weighted = 0;
    let weightSum = 0;
    for (const item of items) {
      weighted += item.driftPct * item.recentAvg;
      weightSum += item.recentAvg;
    }
    overallDriftPct = weightSum > 0 ? Math.round((weighted / weightSum) * 10) / 10 : null;
  }

  return { items, overallDriftPct };
}

export interface CategoryOverrideRow {
  sourceCategory: string;
  displayCategory: string;
}

/** Upper-cased source → display map; blank rows are dropped. */
export function buildCategoryOverrideMap(rows: CategoryOverrideRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const source = row.sourceCategory.trim().toUpperCase();
    const display = row.displayCategory.trim();
    if (!source || !display) continue;
    map.set(source, display);
  }
  return map;
}

/** Remaps a category through the override map; unknowns pass through. */
export function overrideCategory(
  map: Map<string, string>,
  category: string | null,
): string | null {
  if (category === null) return null;
  return map.get(category.trim().toUpperCase()) ?? category;
}

export interface SharedExpense {
  paidBy: string;
  owedBy: string;
  amount: number;
}

/**
 * Nets shared expenses into a single "X owes Y" balance. Null when settled
 * (within a cent) or empty.
 */
export function computeSettleUp(
  entries: SharedExpense[],
): { from: string; to: string; amount: number } | null {
  const net = new Map<string, number>();
  for (const entry of entries) {
    net.set(entry.paidBy, (net.get(entry.paidBy) ?? 0) + entry.amount);
    net.set(entry.owedBy, (net.get(entry.owedBy) ?? 0) - entry.amount);
  }
  let creditor: string | null = null;
  let debtor: string | null = null;
  let max = 0;
  let min = 0;
  for (const [person, balance] of net) {
    if (balance > max) {
      max = balance;
      creditor = person;
    }
    if (balance < min) {
      min = balance;
      debtor = person;
    }
  }
  if (!creditor || !debtor || max < 0.01) return null;
  return { from: debtor, to: creditor, amount: round2(max) };
}

export interface SinkingFundInput {
  name: string;
  targetAmount: number;
  dueDate: string;
}

export interface SinkingFundPlan {
  name: string;
  targetAmount: number;
  dueDate: string;
  monthsLeft: number;
  monthlySetAside: number;
  dueSoon: boolean;
}

const SINKING_DUE_SOON_DAYS = 45;

/**
 * Sinking funds (planned irregular expenses): spread each target over the
 * whole months remaining until its due date. Past-due and due-now funds
 * collapse to one month — the full amount is owed to the plan now.
 */
export function computeSinkingFunds(input: {
  funds: SinkingFundInput[];
  asOf: string;
}): { items: SinkingFundPlan[]; totalMonthlySetAside: number } {
  const [asOfYear, asOfMonth, asOfDay] = input.asOf.split("-").map(Number);
  const dueSoonCutoff = addDays(input.asOf, SINKING_DUE_SOON_DAYS);

  const items = input.funds.map((fund) => {
    const [dueYear, dueMonth, dueDay] = fund.dueDate.split("-").map(Number);
    const wholeMonths =
      (dueYear! - asOfYear!) * 12 +
      (dueMonth! - asOfMonth!) +
      (dueDay! > asOfDay! ? 1 : 0);
    const monthsLeft = Math.max(1, wholeMonths);
    return {
      name: fund.name,
      targetAmount: round2(fund.targetAmount),
      dueDate: fund.dueDate,
      monthsLeft,
      monthlySetAside: round2(fund.targetAmount / monthsLeft),
      dueSoon: fund.dueDate <= dueSoonCutoff,
    };
  });

  return {
    items,
    totalMonthlySetAside: round2(
      items.reduce((sum, item) => sum + item.monthlySetAside, 0),
    ),
  };
}

export interface NetWorthProjectionPoint {
  monthIndex: number;
  netWorth: number;
}

/**
 * Projects net worth forward from the current savings pace. Growth is 0%
 * unless the caller opts into an assumption — an honest default for a tool
 * that mixes cash and non-cash balances.
 */
export function projectNetWorth(input: {
  currentNetWorth: number;
  monthlySavings: number;
  months: number;
  annualGrowthPct?: number;
}): NetWorthProjectionPoint[] {
  const monthlyRate =
    input.annualGrowthPct && input.annualGrowthPct !== 0
      ? Math.pow(1 + input.annualGrowthPct / 100, 1 / 12) - 1
      : 0;
  const series: NetWorthProjectionPoint[] = [];
  let balance = input.currentNetWorth;
  for (let month = 1; month <= input.months; month++) {
    balance = balance * (1 + monthlyRate) + input.monthlySavings;
    series.push({ monthIndex: month, netWorth: round2(balance) });
  }
  return series;
}

export interface NetWorthMilestone {
  key: string;
  title: string;
  body: string;
}

/**
 * Net-worth milestones not yet recorded: first positive net worth, then
 * every $10k step at or below the latest value. The caller records emitted
 * keys so each fires exactly once, ever.
 */
export function detectNetWorthMilestones(input: {
  history: { month: string; netWorth: number }[];
  achieved: string[];
  stepSize?: number;
}): NetWorthMilestone[] {
  const step = input.stepSize ?? 10000;
  const latest = input.history.at(-1);
  if (!latest) return [];
  const achieved = new Set(input.achieved);
  const milestones: NetWorthMilestone[] = [];

  if (latest.netWorth > 0 && !achieved.has("networth:positive")) {
    milestones.push({
      key: "networth:positive",
      title: "Net worth crossed into positive territory",
      body: "Assets now exceed liabilities. Keep it going.",
    });
  }
  for (let k = step; k <= latest.netWorth; k += step) {
    const key = `networth:${k}`;
    if (achieved.has(key)) continue;
    milestones.push({
      key,
      title: `Net worth crossed $${k.toLocaleString("en-US")}`,
      body: `Your net worth reached $${k.toLocaleString("en-US")} as of ${latest.month}.`,
    });
  }
  return milestones;
}

export interface BudgetSuggestion {
  category: string;
  suggestedLimit: number;
  median: number;
  months: number;
}

/**
 * Suggests a monthly budget for categories with spending history but no
 * budget yet: median monthly spend + 5% headroom, rounded up to $5.
 * Requires at least two spending months so one-off splurges never become
 * a suggested budget.
 */
export function suggestBudgets(input: {
  history: { month: string; category: string; amount: number }[];
  existingCategories: string[];
  minMonths?: number;
}): BudgetSuggestion[] {
  const minMonths = input.minMonths ?? 2;
  const existing = new Set(input.existingCategories.map((c) => c.trim().toUpperCase()));
  const byCategory = new Map<string, number[]>();

  for (const row of input.history) {
    if (row.amount <= 0) continue;
    const values = byCategory.get(row.category) ?? [];
    values.push(row.amount);
    byCategory.set(row.category, values);
  }

  const suggestions: BudgetSuggestion[] = [];
  for (const [category, values] of byCategory) {
    if (existing.has(category.trim().toUpperCase())) continue;
    if (values.length < minMonths) continue;
    const med = round2(medianOf(values));
    suggestions.push({
      category,
      suggestedLimit: Math.ceil((med * 1.05) / 5) * 5,
      median: med,
      months: values.length,
    });
  }

  return suggestions.sort((a, b) => b.median - a.median);
}
