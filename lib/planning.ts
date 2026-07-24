import { createHash } from "node:crypto";
import { formatCurrency } from "@/lib/format";

export type EnvelopeStatus = "over" | "at-risk" | "on-track";

export interface BudgetEnvelopeInput {
  budgets: { category: string; monthlyLimit: number; rolloverEnabled?: boolean }[];
  currentSpend: { category: string; amount: number }[];
  previousSpend: { month: string; category: string; amount: number }[];
  /**
   * Prior months the rollover carry should span. Months absent from
   * previousSpend count as zero spend (full carry). Without this, rollover
   * budgets carry nothing.
   */
  windowMonths?: string[];
  dayOfMonth: number;
  daysInMonth: number;
}

export interface BudgetEnvelope {
  category: string;
  monthlyLimit: number;
  spent: number;
  remaining: number;
  projectedSpend: number;
  status: EnvelopeStatus;
  lastMonthSpend: number;
  threeMonthAverage: number;
  /** Unused budget carried in from prior window months (rollover only). */
  carry: number;
  /** monthlyLimit + carry, floored at 0 — what remaining/status compare to. */
  effectiveLimit: number;
}

export type RecurringFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
export type RecurringItemType = "income" | "expense";

export interface RecurringItem {
  name: string;
  amount: number;
  itemType: RecurringItemType;
  frequency: RecurringFrequency;
  nextDate: string;
  category?: string | null;
}

export interface ForecastInput {
  startingBalance: number | null;
  asOf: string;
  horizonDays: number;
  items: RecurringItem[];
  lowBalanceThreshold: number;
}

export interface CashFlowForecast {
  projectedBalance: number;
  lowBalanceRisk: boolean;
  lowestBalance: number;
  assumptions: string[];
  events: {
    date: string;
    name: string;
    amount: number;
    itemType: RecurringItemType;
    projectedBalance: number;
  }[];
}

export interface MerchantRule {
  matchType: "merchant" | "keyword" | "account";
  pattern: string;
  displayName?: string | null;
  category?: string | null;
  enabled: boolean;
}

export interface CleanupTransaction {
  id: string;
  merchant: string;
  category: string | null;
  accountName?: string | null;
}

export interface SpendingAnomalyInput {
  currentTransactions: {
    id: string;
    date: string;
    merchant: string;
    category: string;
    amount: number;
  }[];
  priorCategoryAverages: { category: string; amount: number }[];
  /** Trailing median charge per merchant (prior months, spend only). */
  priorMerchantMedians?: { merchant: string; amount: number }[];
  largeTransactionThreshold: number;
}

export interface SpendingAnomaly {
  kind: "large-transaction" | "category-spike" | "duplicate-charge" | "merchant-spike";
  transactionId?: string;
  category?: string;
  severity: "info" | "warning";
  message: string;
}

export interface NetWorthAccount {
  name: string;
  type: string | null;
  balance: number | null;
  includeInNetWorth?: boolean;
}

export type AlertType =
  | "broken_bank"
  | "budget_exceeded"
  | "goal_reached"
  | "large_transaction"
  | "low_cash_forecast"
  | "price_hike"
  | "new_subscription"
  | "milestone"
  | "cancellation_watch";

export interface AlertPreferences {
  broken_bank?: boolean;
  budget_exceeded?: boolean;
  goal_reached?: boolean;
  large_transaction?: boolean;
  low_cash_forecast?: boolean;
  price_hike?: boolean;
  new_subscription?: boolean;
  milestone?: boolean;
  cancellation_watch?: boolean;
}

const ALERT_SEVERITY: Record<AlertType, "info" | "success" | "warning" | "danger"> = {
  broken_bank: "danger",
  budget_exceeded: "warning",
  goal_reached: "success",
  large_transaction: "warning",
  low_cash_forecast: "warning",
  price_hike: "warning",
  new_subscription: "info",
  milestone: "success",
  cancellation_watch: "danger",
};

const SAFE_AI_KEYS = new Set([
  "date",
  "merchant",
  "category",
  "amount",
  "month",
  "summary",
  "income",
  "spending",
  "savings",
]);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

function nextOccurrence(date: string, frequency: RecurringFrequency): string {
  if (frequency === "weekly") return addDays(date, 7);
  if (frequency === "biweekly") return addDays(date, 14);
  if (frequency === "quarterly") return addMonths(date, 3);
  if (frequency === "yearly") return addMonths(date, 12);
  return addMonths(date, 1);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function buildBudgetEnvelopes(input: BudgetEnvelopeInput): BudgetEnvelope[] {
  const currentSpend = new Map(input.currentSpend.map((row) => [row.category, row.amount]));
  const previousByCategory = new Map<string, { month: string; amount: number }[]>();

  for (const row of input.previousSpend) {
    const rows = previousByCategory.get(row.category) ?? [];
    rows.push(row);
    previousByCategory.set(row.category, rows);
  }

  const day = Math.max(1, input.dayOfMonth);
  const days = Math.max(day, input.daysInMonth);

  return input.budgets.map((budget) => {
    const spent = round2(currentSpend.get(budget.category) ?? 0);
    const projectedSpend = round2((spent / day) * days);
    const history = (previousByCategory.get(budget.category) ?? []).sort((a, b) =>
      a.month.localeCompare(b.month),
    );
    const lastMonthSpend = round2(history.at(-1)?.amount ?? 0);
    const lastThree = history.slice(-3);
    const threeMonthAverage = round2(
      lastThree.length === 0
        ? 0
        : lastThree.reduce((sum, row) => sum + row.amount, 0) / lastThree.length,
    );

    let carry = 0;
    if (budget.rolloverEnabled && (input.windowMonths?.length ?? 0) > 0) {
      const spendByMonth = new Map(history.map((row) => [row.month, row.amount]));
      for (const month of input.windowMonths!) {
        carry += budget.monthlyLimit - (spendByMonth.get(month) ?? 0);
      }
      carry = round2(carry);
    }
    const effectiveLimit = Math.max(0, round2(budget.monthlyLimit + carry));

    const remaining = round2(effectiveLimit - spent);
    const status: EnvelopeStatus =
      spent > effectiveLimit ? "over" : projectedSpend > effectiveLimit ? "at-risk" : "on-track";

    return {
      category: budget.category,
      monthlyLimit: round2(budget.monthlyLimit),
      spent,
      remaining,
      projectedSpend,
      status,
      lastMonthSpend,
      threeMonthAverage,
      carry,
      effectiveLimit,
    };
  });
}

export function forecastCashFlow(input: ForecastInput): CashFlowForecast {
  let balance = round2(input.startingBalance ?? 0);
  let lowestBalance = balance;
  const endDate = addDays(input.asOf, input.horizonDays);
  const events: CashFlowForecast["events"] = [];

  for (const item of input.items) {
    let cursor = item.nextDate;
    while (cursor >= input.asOf && cursor <= endDate) {
      const signed = item.itemType === "income" ? Math.abs(item.amount) : -Math.abs(item.amount);
      events.push({
        date: cursor,
        name: item.name,
        amount: signed,
        itemType: item.itemType,
        projectedBalance: 0,
      });
      cursor = nextOccurrence(cursor, item.frequency);
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  for (const event of events) {
    balance = round2(balance + event.amount);
    event.projectedBalance = balance;
    lowestBalance = Math.min(lowestBalance, balance);
  }

  return {
    projectedBalance: balance,
    lowestBalance: round2(lowestBalance),
    lowBalanceRisk: lowestBalance < input.lowBalanceThreshold,
    assumptions: [
      `Starts from ${formatCurrency(input.startingBalance ?? 0)} cash.`,
      `Looks ahead ${input.horizonDays} days from ${input.asOf}.`,
      "Uses enabled recurring income and expense items only.",
    ],
    events,
  };
}

export function groupRecurringByWeek(items: RecurringItem[], asOf: string, horizonDays: number) {
  const endDate = addDays(asOf, horizonDays);
  const groups = new Map<string, Array<RecurringItem & { status: "expected" }>>();

  for (const item of items) {
    if (item.nextDate < asOf || item.nextDate > endDate) continue;
    const due = parseDate(item.nextDate);
    const day = due.getUTCDay();
    const weekStart = new Date(due);
    weekStart.setUTCDate(due.getUTCDate() - ((day + 6) % 7));
    const key = isoDate(weekStart);
    const rows = groups.get(key) ?? [];
    rows.push({ ...item, status: "expected" });
    groups.set(key, rows);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, rows]) => ({
      weekStart,
      items: rows.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name)),
    }));
}

export type BillGrouping = "weekly" | "monthly";

export interface BillPeriod {
  periodStart: string;
  items: Array<RecurringItem & { status: "expected" }>;
  expenseTotal: number;
  incomeTotal: number;
}

/**
 * Groups upcoming recurring bills/paychecks into weekly (Monday-keyed) or
 * monthly buckets, expanding each item's occurrences across the horizon —
 * a weekly gym charge appears once per week, not once total. Each expanded
 * item's nextDate is the occurrence date.
 */
export function groupRecurringByPeriod(
  items: RecurringItem[],
  asOf: string,
  horizonDays: number,
  grouping: BillGrouping,
): BillPeriod[] {
  const endDate = addDays(asOf, horizonDays);
  const groups = new Map<string, Array<RecurringItem & { status: "expected" }>>();

  for (const item of items) {
    let cursor = item.nextDate;
    // Advance stale anchors forward without emitting past occurrences.
    for (let i = 0; i < 500 && cursor < asOf; i++) {
      cursor = nextOccurrence(cursor, item.frequency);
    }
    while (cursor >= asOf && cursor <= endDate) {
      let key: string;
      if (grouping === "monthly") {
        key = `${cursor.slice(0, 7)}-01`;
      } else {
        const due = parseDate(cursor);
        const weekStart = new Date(due);
        weekStart.setUTCDate(due.getUTCDate() - ((due.getUTCDay() + 6) % 7));
        key = isoDate(weekStart);
      }
      const rows = groups.get(key) ?? [];
      rows.push({ ...item, nextDate: cursor, status: "expected" });
      groups.set(key, rows);
      cursor = nextOccurrence(cursor, item.frequency);
    }
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodStart, rows]) => {
      const sorted = rows.sort(
        (a, b) => a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name),
      );
      let expenseTotal = 0;
      let incomeTotal = 0;
      for (const row of sorted) {
        if (row.itemType === "income") incomeTotal += Math.abs(row.amount);
        else expenseTotal += Math.abs(row.amount);
      }
      return {
        periodStart,
        items: sorted,
        expenseTotal: round2(expenseTotal),
        incomeTotal: round2(incomeTotal),
      };
    });
}

function matchesRule(transaction: CleanupTransaction, rule: MerchantRule): boolean {
  if (!rule.enabled) return false;
  const pattern = normalize(rule.pattern);
  if (!pattern) return false;
  if (rule.matchType === "account") return normalize(transaction.accountName ?? "").includes(pattern);
  if (rule.matchType === "merchant") return normalize(transaction.merchant) === pattern;
  return normalize(transaction.merchant).includes(pattern);
}

export function applyMerchantRules(
  transactions: CleanupTransaction[],
  rules: MerchantRule[],
): CleanupTransaction[] {
  return transactions.map((transaction) => {
    const rule = rules.find((candidate) => matchesRule(transaction, candidate));
    if (!rule) return { ...transaction };
    return {
      ...transaction,
      merchant: rule.displayName?.trim() || transaction.merchant,
      category: rule.category?.trim() || transaction.category,
    };
  });
}

export function previewMerchantRules(transactions: CleanupTransaction[], rules: MerchantRule[]) {
  const applied = applyMerchantRules(transactions, rules);
  return applied
    .map((after, index) => ({ before: transactions[index]!, after }))
    .filter(({ before, after }) => before.merchant !== after.merchant || before.category !== after.category)
    .map(({ before, after }) => ({
      transactionId: before.id,
      before,
      after,
    }));
}

/** A merchant spike needs 2× the median AND a $25 jump — small-dollar
 * merchants (coffee, parking) double all the time without meaning anything. */
const MERCHANT_SPIKE_FACTOR = 2;
const MERCHANT_SPIKE_MIN_INCREASE = 25;

export function detectSpendingAnomalies(input: SpendingAnomalyInput): SpendingAnomaly[] {
  const anomalies: SpendingAnomaly[] = [];
  const categoryTotals = new Map<string, number>();
  const priorAverages = new Map(input.priorCategoryAverages.map((row) => [row.category, row.amount]));
  const merchantMedians = new Map(
    (input.priorMerchantMedians ?? []).map((row) => [normalize(row.merchant), row.amount]),
  );
  const seen = new Set<string>();
  const duplicateKeys = new Set<string>();

  for (const transaction of input.currentTransactions) {
    if (transaction.amount >= input.largeTransactionThreshold) {
      anomalies.push({
        kind: "large-transaction",
        transactionId: transaction.id,
        severity: "warning",
        message: `${transaction.merchant} is larger than usual review threshold.`,
      });
    }

    const merchantMedian = merchantMedians.get(normalize(transaction.merchant)) ?? 0;
    if (
      merchantMedian > 0 &&
      transaction.amount >= merchantMedian * MERCHANT_SPIKE_FACTOR &&
      transaction.amount - merchantMedian >= MERCHANT_SPIKE_MIN_INCREASE
    ) {
      anomalies.push({
        kind: "merchant-spike",
        transactionId: transaction.id,
        severity: "warning",
        message: `${transaction.merchant} charged ${formatCurrency(transaction.amount)}, well above its usual ${formatCurrency(merchantMedian)}.`,
      });
    }

    categoryTotals.set(transaction.category, (categoryTotals.get(transaction.category) ?? 0) + transaction.amount);
    const duplicateKey = `${transaction.date}|${normalize(transaction.merchant)}|${transaction.amount.toFixed(2)}`;
    if (seen.has(duplicateKey) && !duplicateKeys.has(duplicateKey)) {
      duplicateKeys.add(duplicateKey);
      anomalies.push({
        kind: "duplicate-charge",
        transactionId: transaction.id,
        severity: "warning",
        message: `${transaction.merchant} appears more than once with the same date and amount.`,
      });
    }
    seen.add(duplicateKey);
  }

  for (const [category, total] of categoryTotals) {
    const average = priorAverages.get(category);
    if (average && total >= average * 1.5 && total - average >= 50) {
      anomalies.push({
        kind: "category-spike",
        category,
        severity: "info",
        message: `${category} is above its recent average.`,
      });
    }
  }

  return anomalies;
}

export function computeNetWorthSnapshot(accounts: NetWorthAccount[]) {
  let assets = 0;
  let liabilities = 0;

  for (const account of accounts) {
    if (account.includeInNetWorth === false) continue;
    const balance = Math.abs(account.balance ?? 0);
    if (["credit", "liability", "debt", "loan"].includes(account.type ?? "")) {
      liabilities += balance;
    } else {
      assets += balance;
    }
  }

  return {
    assets: round2(assets),
    liabilities: round2(liabilities),
    netWorth: round2(assets - liabilities),
  };
}

export function buildNotification(
  type: AlertType,
  details: { title: string; body: string },
) {
  return {
    type,
    severity: ALERT_SEVERITY[type],
    title: details.title.slice(0, 160),
    body: details.body.slice(0, 500),
    readAt: null,
  };
}

export function shouldSendAlert(type: AlertType, preferences: AlertPreferences): boolean {
  return preferences[type] !== false;
}

export function toAiInsightPayload(input: {
  enabled: boolean;
  exportRows: Array<Record<string, unknown>>;
}): { rows: Array<Record<string, unknown>> } | null {
  if (!input.enabled) return null;
  return {
    rows: input.exportRows.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => SAFE_AI_KEYS.has(key))),
    ),
  };
}

export function buildImportReview(
  rows: { date: string; amount: number; merchant: string; category: string | null }[],
  existingFingerprints: Set<string>,
) {
  const seen = new Set<string>();
  const reviewRows: Array<{
    rowHash: string;
    row: { date: string; amount: number; merchant: string; category: string | null };
    flags: string[];
    status: "pending" | "approved" | "rejected" | "committed";
  }> = rows.map((row) => {
    const fingerprint = `${row.date}|${row.amount.toFixed(2)}|${row.merchant}`;
    const flags: string[] = [];
    if (existingFingerprints.has(fingerprint)) flags.push("possible-duplicate");
    if (seen.has(fingerprint)) flags.push("file-duplicate");
    seen.add(fingerprint);
    const hash = createHash("sha1").update(fingerprint).digest("hex");
    return {
      rowHash: hash,
      row,
      flags,
      status: "pending",
    };
  });

  return {
    rows: reviewRows,
    approvedCount: reviewRows.filter((row) => row.status === "approved").length,
  };
}

export function canManageHousehold(input: {
  userId: string;
  householdOwnerId: string;
  role: "owner" | "member" | "read_only";
}): boolean {
  return input.userId === input.householdOwnerId && input.role === "owner";
}
