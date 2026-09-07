import { loadRecurringInputs } from "@/lib/recurring-data";
import { buildDashboardRecurring } from "@/lib/dashboard-recurring";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBudgetEnvelopes,
  computeNetWorthSnapshot,
  detectSpendingAnomalies,
  forecastCashFlow,
  groupRecurringByPeriod,
  groupRecurringByWeek,
  type BillPeriod,
  type BudgetEnvelope,
  type CashFlowForecast,
  type NetWorthAccount,
  type SpendingAnomaly,
} from "@/lib/planning";
import { accountDisplayLabel } from "@/lib/account-label";
import { buildPayoffPlan, type PayoffPlan } from "@/lib/debt";
import type { buildRecurringStatuses } from "@/lib/planning-depth";
import {
  computeMerchantPriceDrift,
  computeRunwayMonths,
  computeSafeToSpend,
  computeSavingsRateSeries,
  computeSinkingFunds,
  type SinkingFundInput,
  type SinkingFundPlan,
  detectPaychecks,
  medianOf,
  splitEssentialsByMonth,
  type EssentialsSplit,
  type MerchantPriceDrift,
  type Paycheck,
  type SafeToSpend,
  type SavingsRatePoint,
} from "@/lib/insights";
import { aggregateSpendWithSplits, validateSplits } from "@/lib/transaction-quality";
import { localDateKey } from "@/lib/format-date";
import { normalizeExternalDisplayText } from "@/lib/external-display-text";
import {
  fromTransactionRow,
  projectFinanceTransactions,
  UNCATEGORIZED,
  type FinanceFlow,
  type RawFinanceTransaction,
  type TransactionRow,
} from "@/lib/finance-domain";
import {
  buildCategoryDrilldown,
  buildMerchantDrilldown,
  normalizeDrillParams,
  OTHER_CATEGORY_KEY,
  type DrilldownData,
  type DrillParams,
  type DrillTxn,
} from "@/lib/drilldown";
import {
  buildDashboardBudgetGroups,
  type DashboardBudgetGroup,
} from "@/lib/dashboard-budget-groups";
import { toRecurringItem } from "@/lib/scheduled-transactions";
import {
  composeNetWorthAccounts,
  readExcludedNetWorthIds,
  type ManualBalanceRow,
  type PlaidBalanceRow,
} from "@/lib/net-worth-inputs";
/**
 * Aggregations for the dashboard. Runs with the caller's user-scoped Supabase
 * client, so RLS guarantees only the current user's rows are visible.
 *
 * Sign convention (Plaid): positive amount = money out (spending),
 * negative = money in (income). Transfers are excluded from spend/income totals.
 */

/**
 * Categories that are cash movement rather than spending. Aliases the canonical
 * `TRANSFER_GROUPS` so the app has exactly one definition; prefer importing it
 * from `lib/finance-domain` in new code.
 */
export { TRANSFER_GROUPS as EXCLUDED_PFC } from "@/lib/finance-domain";

export interface AccountSummary {
  id: string;
  user_id?: string | null;
  name: string | null;
  official_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  credit_limit: number | null;
  iso_currency_code: string | null;
  plaid_item_id: string;
  /** User-entered APR for the debt planner (Plaid doesn't provide it). */
  apr: number | null;
}

export interface DashboardData {
  accounts: AccountSummary[];
  creditAccounts: AccountSummary[];
  monthlySpending: { month: string; amount: number }[];
  monthlyIncome: { month: string; amount: number }[];
  monthlyCashFlow: { month: string; deposits: number; withdrawals: number }[];
  categoryBreakdown: { category: string; amount: number }[];
  merchantBreakdown: { merchant: string; amount: number }[];
  currentMonthExpenses: number;
  currentMonthIncome: number;
  subscriptions: {
    merchant: string;
    amount: number;
    frequency: string | null;
    category: string | null;
    predictedNextDate: string | null;
  }[];
  incomeStreams: {
    merchant: string;
    amount: number;
    frequency: string | null;
    predictedNextDate: string | null;
  }[];
  availableMonths: string[];
  selectedMonth: string;
  /** Viewer's calendar day (YYYY-MM-DD) this load was keyed on (M-11). */
  today: string;
  /** Completion time of the newest successful sync job, or null if none. */
  lastSyncAt: string | null;
  /** Whole minutes since lastSyncAt (null when never synced). */
  lastSyncAgoMinutes: number | null;
  /** True when banks are connected but no sync has succeeded in 48h. */
  syncIsStale: boolean;
  totalBudget: number;
  lastMonthProratedSpent: number;
  spendPerCard: { name: string; amount: number; accountId: string }[];
  spendPerBank: { name: string; amount: number; itemId: string | null }[];
  cashFlow: { deposits: number; withdrawals: number; net: number };
  budgetEnvelopes: BudgetEnvelope[];
  budgetGroups: DashboardBudgetGroup[];
  cashFlowForecast: CashFlowForecast;
  recurringWeeks: ReturnType<typeof groupRecurringByWeek>;
  spendingAnomalies: SpendingAnomaly[];
  netWorthSnapshot: { assets: number; liabilities: number; netWorth: number };
  netWorthHistory: { month: string; assets: number; liabilities: number; netWorth: number }[];
  recurringStatuses: ReturnType<typeof buildRecurringStatuses>;
  /**
   * Active-month spend split by person (household scope only, 4.3):
   * `mine` is the requesting user's spend, `household` is everyone else's
   * shared spend. Null outside household scope or with no partner data.
   */
  spendPerPerson: { mine: number; household: number } | null;
  /** Upcoming bills grouped both ways; the Plan view toggles between them. */
  billPeriods: { weekly: BillPeriod[]; monthly: BillPeriod[] };
  /** Pure financial-intelligence derivations (lib/insights.ts). */
  insights: {
    savingsRateSeries: SavingsRatePoint[];
    essentialsSplit: EssentialsSplit[];
    runwayMonths: number | null;
    paycheck: Paycheck | null;
    safeToSpend: SafeToSpend | null;
    priceDrift: MerchantPriceDrift;
    sinkingFunds: { items: SinkingFundPlan[]; totalMonthlySetAside: number };
    debt: {
      plan: PayoffPlan | null;
      planWithExtra: PayoffPlan | null;
      extraMonthly: number;
      usesAssumedApr: boolean;
    } | null;
  };
  drilldown?: DrilldownData;
  /**
   * Lower-cased merchant names present in the 6-month window's spend. A merchant
   * drill only resolves for these, so the UI can avoid rendering a dead link
   * (e.g. a recurring stream whose name matches no transaction).
   */
  drillableMerchants: string[];
}

interface TxnLite {
  id: string;
  date: string;
  amount: number;
  merchant_name: string | null;
  name: string | null;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  account_id: string;
  user_id: string;
  /** Spend/income classification decided once by the canonical projection. */
  flow: FinanceFlow;
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

/** "2026-07" + delta months, pure string math (no timezone surprises). */
function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y! * 12 + (m! - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** Newest → oldest month keys, capped so a decade of data stays bounded. */
function enumerateMonths(newest: string, oldest: string, cap = 120): string[] {
  const months: string[] = [];
  let cursor = newest;
  while (months.length < cap) {
    months.push(cursor);
    if (cursor <= oldest) break;
    cursor = addMonths(cursor, -1);
  }
  return months;
}

function isSpending(t: TxnLite): boolean {
  return t.flow === "expense";
}

function isIncome(t: TxnLite): boolean {
  return t.flow === "income";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const STALE_AFTER_MS = 48 * 3600 * 1000;

function normalizeFrequency(frequency: string | null): "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" {
  const value = (frequency ?? "").toLowerCase();
  if (value.includes("week") && value.includes("bi")) return "biweekly";
  if (value.includes("week")) return "weekly";
  if (value.includes("quarter")) return "quarterly";
  if (value.includes("year")) return "yearly";
  return "monthly";
}

function monthDate(month: string, day: number): string {
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  return `${month}-${String(Math.min(day, daysInMonth)).padStart(2, "0")}`;
}

interface DashboardTransactionAggregates {
  monthlySpending: { month: string; amount: number }[];
  monthlyIncome: { month: string; amount: number }[];
  monthlyCashFlow: { month: string; deposits: number; withdrawals: number }[];
  merchantMap: Map<string, number>;
  categoryHistoryMap: Map<string, number>;
  currentMonthExpenses: number;
  currentMonthIncome: number;
  activeMonthSpend: TxnLite[];
  windowSpendTxns: DrillTxn[];
  windowSpendMerchants: Set<string>;
}

function aggregateMonthlyMaps(spendTxns: TxnLite[]): {
  spending: Map<string, number>;
  income: Map<string, number>;
} {
  const spending = new Map<string, number>();
  const income = new Map<string, number>();
  for (const txn of spendTxns) {
    const key = monthKey(txn.date);
    if (isSpending(txn)) spending.set(key, (spending.get(key) ?? 0) + txn.amount);
    else if (isIncome(txn)) income.set(key, (income.get(key) ?? 0) + Math.abs(txn.amount));
  }
  return { spending, income };
}

function aggregateCashFlowMaps(
  allTxnsRaw: TxnLite[],
  accountTypeById: Map<string, string | null>,
): { deposits: Map<string, number>; withdrawals: Map<string, number> } {
  const deposits = new Map<string, number>();
  const withdrawals = new Map<string, number>();
  for (const txn of allTxnsRaw) {
    if (accountTypeById.get(txn.account_id) !== "depository") continue;
    const key = monthKey(txn.date);
    const target = txn.amount < 0 ? deposits : withdrawals;
    const amount = Math.abs(txn.amount);
    target.set(key, (target.get(key) ?? 0) + amount);
  }
  return { deposits, withdrawals };
}

export function shiftMonthKey(month: string, deltaMonths: number): string {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const totalMonths = year * 12 + (monthNum - 1) + deltaMonths;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}

function buildMonthlyAggregates(
  activeMonth: string,
  spending: Map<string, number>,
  income: Map<string, number>,
  deposits: Map<string, number>,
  withdrawals: Map<string, number>,
): Pick<DashboardTransactionAggregates, "monthlySpending" | "monthlyIncome" | "monthlyCashFlow"> {
  const monthlySpending: DashboardTransactionAggregates["monthlySpending"] = [];
  const monthlyIncome: DashboardTransactionAggregates["monthlyIncome"] = [];
  const monthlyCashFlow: DashboardTransactionAggregates["monthlyCashFlow"] = [];
  for (let index = 5; index >= 0; index--) {
    const key = shiftMonthKey(activeMonth, -index);
    monthlySpending.push({ month: key, amount: round2(spending.get(key) ?? 0) });
    monthlyIncome.push({ month: key, amount: round2(income.get(key) ?? 0) });
    monthlyCashFlow.push({
      month: key,
      deposits: round2(deposits.get(key) ?? 0),
      withdrawals: round2(withdrawals.get(key) ?? 0),
    });
  }
  return { monthlySpending, monthlyIncome, monthlyCashFlow };
}

function extractMerchantName(
  txn: { merchant_name?: string | null; name?: string | null },
  fallback = "Unknown",
): string {
  return txn.merchant_name ?? txn.name ?? fallback;
}

function aggregateActiveMonth(
  spendTxns: TxnLite[],
  activeMonth: string,
): Pick<DashboardTransactionAggregates, "merchantMap" | "categoryHistoryMap" | "currentMonthExpenses" | "currentMonthIncome" | "activeMonthSpend"> {
  const merchantMap = new Map<string, number>();
  const categoryHistoryMap = new Map<string, number>();
  const activeMonthSpend: TxnLite[] = [];
  let currentMonthExpenses = 0;
  let currentMonthIncome = 0;
  for (const txn of spendTxns) {
    const month = monthKey(txn.date);
    if (isSpending(txn)) {
      const key = `${month}|${txn.pfc_primary ?? "UNCATEGORIZED"}`;
      categoryHistoryMap.set(key, (categoryHistoryMap.get(key) ?? 0) + txn.amount);
    }
    if (month !== activeMonth) continue;
    if (isSpending(txn)) {
      currentMonthExpenses += txn.amount;
      activeMonthSpend.push(txn);
      const merchant = extractMerchantName(txn);
      merchantMap.set(merchant, (merchantMap.get(merchant) ?? 0) + txn.amount);
    } else if (isIncome(txn)) currentMonthIncome += Math.abs(txn.amount);
  }
  return { merchantMap, categoryHistoryMap, currentMonthExpenses, currentMonthIncome, activeMonthSpend };
}

function aggregateDashboardTransactions(
  spendTxns: TxnLite[],
  allTxnsRaw: TxnLite[],
  allAccounts: AccountSummary[],
  activeMonth: string,
): DashboardTransactionAggregates {
  const accountTypeById = new Map(allAccounts.map((account) => [account.id, account.type]));
  const monthlyMaps = aggregateMonthlyMaps(spendTxns);
  const cashFlowMaps = aggregateCashFlowMaps(allTxnsRaw, accountTypeById);
  const monthly = buildMonthlyAggregates(
    activeMonth,
    monthlyMaps.spending,
    monthlyMaps.income,
    cashFlowMaps.deposits,
    cashFlowMaps.withdrawals,
  );
  const active = aggregateActiveMonth(spendTxns, activeMonth);
  const windowSpendTxns = spendTxns.filter(isSpending).map((txn) => ({
    id: txn.id,
    date: txn.date,
    amount: txn.amount,
    merchant: extractMerchantName(txn),
    category: txn.pfc_primary,
    subcategory: txn.pfc_detailed,
  }));
  const windowSpendMerchants = new Set(
    windowSpendTxns.map((txn) => txn.merchant.trim().toLowerCase()),
  );
  return {
    ...monthly,
    ...active,
    windowSpendTxns,
    windowSpendMerchants,
  };
}

function buildDashboardDrilldown(
  drill: DrillParams | undefined,
  windowSpendTxns: DrillTxn[],
  splits: { transactionId: string; category: string; amount: number }[],
  monthlySpending: { month: string; amount: number }[],
  activeMonth: string,
  windowSpendMerchants: Set<string>,
): DrilldownData | undefined {
  if (!drill || (!drill.category && !drill.merchant)) return undefined;
  const knownCategories = new Set(windowSpendTxns.map((txn) => txn.category ?? "UNCATEGORIZED"));
  const knownSubcategories = new Set(windowSpendTxns.map((txn) => txn.subcategory ?? "UNCATEGORIZED"));
  for (const split of splits) knownCategories.add(split.category);
  const normalized = normalizeDrillParams(drill, {
    categories: knownCategories,
    subcategories: knownSubcategories,
    merchants: windowSpendMerchants,
  });
  const months = monthlySpending.map((month) => month.month);
  if (normalized.category && normalized.category !== OTHER_CATEGORY_KEY) {
    return buildCategoryDrilldown({
      txns: windowSpendTxns,
      splits,
      category: normalized.category,
      sub: normalized.sub ?? null,
      months,
      activeMonth,
    });
  }
  if (normalized.merchant) {
    return buildMerchantDrilldown({ txns: windowSpendTxns, merchant: normalized.merchant, months });
  }
  return undefined;
}

interface DashboardSpendMetricsInput {
  spendTxns: TxnLite[];
  allTxnsRaw: TxnLite[];
  allAccounts: AccountSummary[];
  allItems: Array<{ id: string; institution_name: string | null }>;
  activeMonth: string;
  lastMonthTargetDay: number;
  activeYear: number;
  activeMonthIndex: number;
}

function buildDashboardSpendMetrics(input: DashboardSpendMetricsInput) {
  const {
    spendTxns,
    allTxnsRaw,
    allAccounts,
    allItems,
    activeMonth,
    lastMonthTargetDay,
  } = input;
  const lastMonth = shiftMonthKey(activeMonth, -1);
  let lastMonthProratedSpent = 0;
  const cardSpendMap = new Map<string, number>();
  const bankSpendMap = new Map<string, number>();
  let cashFlowDeposits = 0;
  let cashFlowWithdrawals = 0;
  const accountById = new Map(allAccounts.map((account) => [account.id, account]));
  for (const txn of spendTxns) {
    if (monthKey(txn.date) === lastMonth && Number(txn.date.slice(8, 10)) <= lastMonthTargetDay && isSpending(txn)) {
      lastMonthProratedSpent += txn.amount;
    }
    if (monthKey(txn.date) !== activeMonth || !isSpending(txn)) continue;
    cardSpendMap.set(txn.account_id, (cardSpendMap.get(txn.account_id) ?? 0) + txn.amount);
    const itemId = accountById.get(txn.account_id)?.plaid_item_id ?? "";
    bankSpendMap.set(itemId, (bankSpendMap.get(itemId) ?? 0) + txn.amount);
  }
  for (const txn of allTxnsRaw) {
    if (monthKey(txn.date) !== activeMonth || accountById.get(txn.account_id)?.type !== "depository") continue;
    if (txn.amount < 0) cashFlowDeposits += Math.abs(txn.amount);
    else cashFlowWithdrawals += txn.amount;
  }
  const spendPerCard = [...cardSpendMap].map(([accountId, amount]) => {
    const account = accountById.get(accountId);
    // Display only; the row is joined back on `accountId`, never on this text.
    const name = account ? accountDisplayLabel(account.name, account.mask) : "Unknown Account";
    return { name, amount: round2(amount), accountId };
  }).sort((a, b) => b.amount - a.amount);
  const spendPerBank = [...bankSpendMap].map(([itemId, amount]) => ({
    name: itemId ? allItems.find((item) => item.id === itemId)?.institution_name ?? "Other Bank" : "Unknown Bank",
    amount: round2(amount),
    itemId: itemId || null,
  })).sort((a, b) => b.amount - a.amount);
  return {
    lastMonthProratedSpent,
    spendPerCard,
    spendPerBank,
    cashFlow: { deposits: round2(cashFlowDeposits), withdrawals: round2(cashFlowWithdrawals), net: round2(cashFlowDeposits - cashFlowWithdrawals) },
  };
}

/**
 * Per-person attribution (4.3). Only meaningful in household scope, where the
 * window can contain a partner's shared rows; null everywhere else, and null
 * when nothing in the active month came from anyone but the caller.
 */
function computeSpendPerPerson(
  spendTxns: readonly TxnLite[],
  activeMonth: string,
  userId: string | undefined,
  scope: DashboardOptions["scope"],
): { mine: number; household: number } | null {
  if (scope !== "household" || !userId) return null;
  let mine = 0;
  let household = 0;
  for (const t of spendTxns) {
    if (monthKey(t.date) !== activeMonth || !isSpending(t)) continue;
    if (t.user_id === userId) mine += t.amount;
    else household += t.amount;
  }
  return household > 0 ? { mine: round2(mine), household: round2(household) } : null;
}

/**
 * Debt payoff planner (1.10) over carried credit-card balances. Cards without
 * a user-entered APR assume a typical rate and say so in the UI.
 */
function buildDebtSummary(allAccounts: readonly AccountSummary[]): DashboardData["insights"]["debt"] {
  const ASSUMED_APR = 22;
  const DEBT_EXTRA_MONTHLY = 200;
  const debtAccounts = allAccounts.filter(
    (a) => a.type === "credit" && Number(a.current_balance ?? 0) > 0,
  );
  if (debtAccounts.length === 0) return null;
  const debtInputs = debtAccounts.map((a) => {
    return {
      // Same label the Debt payoff page builds, so the two surfaces agree.
      name: accountDisplayLabel(a.name ?? "Card", a.mask),
      balance: Number(a.current_balance),
      apr: a.apr ?? ASSUMED_APR,
    };
  });
  return {
    plan: buildPayoffPlan({ debts: debtInputs, extraMonthly: 0, strategy: "avalanche" }),
    planWithExtra: buildPayoffPlan({
      debts: debtInputs,
      extraMonthly: DEBT_EXTRA_MONTHLY,
      strategy: "avalanche",
    }),
    extraMonthly: DEBT_EXTRA_MONTHLY,
    usesAssumedApr: debtAccounts.some((a) => a.apr === null || a.apr === undefined),
  };
}

/**
 * Per-merchant trailing medians from the prior window months. Two charges
 * minimum: one prior charge doesn't establish what "usual" looks like.
 */
function computePriorMerchantMedians(
  spendTxns: readonly TxnLite[],
  activeMonth: string,
): Array<{ merchant: string; amount: number }> {
  const amountsByMerchant = new Map<string, { name: string; amounts: number[] }>();
  for (const t of spendTxns) {
    if (monthKey(t.date) === activeMonth || !isSpending(t)) continue;
    const name = extractMerchantName(t);
    const key = name.trim().toLowerCase();
    const entry = amountsByMerchant.get(key) ?? { name, amounts: [] };
    entry.amounts.push(t.amount);
    amountsByMerchant.set(key, entry);
  }
  return [...amountsByMerchant.values()]
    .filter((entry) => entry.amounts.length >= 2)
    .map((entry) => ({ merchant: entry.name, amount: round2(medianOf(entry.amounts)) }));
}

export interface DashboardOptions {
  itemId?: string;
  drill?: DrillParams;
  /**
   * "mine" (default) scopes every query to the caller's own rows.
   * "household" skips the explicit user filter so RLS-visible shared rows
   * (per-connection household sharing, 4.2) blend in. ONLY meaningful with
   * the RLS-bound user client — service-client callers must never pass it.
   */
  scope?: "mine" | "household";
  /**
   * When false, skips querying manual_accounts and profiles (balance sheet inputs).
   * Defaults to true.
   */
  includeBalanceSheet?: boolean;
  /**
   * Viewer's calendar day (YYYY-MM-DD) in their profile timezone (M-11).
   * The open-month key, "current month" day counts, and the live net-worth
   * point all derive from this instead of the server clock, so an evening
   * session west of UTC no longer straddles two months. Defaults to the
   * server-local day when the caller has no profile timezone handy.
   */
  today?: string;
}

interface DashboardOverrideRow {
  transaction_id: string;
  display_category: string | null;
  cash_flow_classification: "expense" | "income" | null;
}

const DASHBOARD_OVERRIDE_CHUNK_SIZE = 250;
const DASHBOARD_OVERRIDE_PAGE_SIZE = 1_000;
/** PostgREST max_rows is 1,000: page the window read so totals never truncate. */
const DASHBOARD_TXN_PAGE_SIZE = 1_000;

async function loadDashboardOverrides(
  supabase: SupabaseClient,
  transactionIds: string[],
  userId: string | undefined,
  applyUserScope: boolean,
): Promise<DashboardOverrideRow[]> {
  if (transactionIds.length === 0) return [];
  const chunks: string[][] = [];
  for (let index = 0; index < transactionIds.length; index += DASHBOARD_OVERRIDE_CHUNK_SIZE) {
    chunks.push(transactionIds.slice(index, index + DASHBOARD_OVERRIDE_CHUNK_SIZE));
  }
  const chunkRows = await Promise.all(
    chunks.map(async (ids) => {
      const rows: DashboardOverrideRow[] = [];
      for (let page = 0; ; page += 1) {
        const from = page * DASHBOARD_OVERRIDE_PAGE_SIZE;
        let query = supabase
          .from("transaction_annotations")
          .select("transaction_id, display_category, cash_flow_classification")
          .in("transaction_id", ids);
        if (userId && applyUserScope) query = query.eq("user_id", userId);
        const { data, error } = await query
          .order("transaction_id")
          .range(from, from + DASHBOARD_OVERRIDE_PAGE_SIZE - 1);
        if (error) throw error;
        const batch = (data ?? []) as DashboardOverrideRow[];
        rows.push(...batch);
        if (batch.length < DASHBOARD_OVERRIDE_PAGE_SIZE) break;
      }
      return rows;
    }),
  );
  return chunkRows.flat();
}

interface QueryResult<T> {
  data: T | null;
  error?: unknown;
}

/**
 * Envelope spend rows keyed by (group, detailed) pair (M-1): each txn feeds
 * exactly one pair bucket carrying both keys, so a detailed budget and a
 * group budget resolve the same spend without double-counting it. Split
 * parts keep only their detailed key (their group is unknown), matching the
 * categoryBreakdown treatment they already get.
 */
function toEnvelopeSpendRows(
  txns: Pick<TxnLite, "id" | "amount" | "pfc_primary" | "pfc_detailed">[],
  splits: { transactionId: string; category: string; amount: number }[],
): { category: string; amount: number; groupKey: string | null; categoryKey: string | null }[] {
  const splitsByTxn = new Map<string, { transactionId: string; category: string; amount: number }[]>();
  for (const split of splits) {
    const rows = splitsByTxn.get(split.transactionId) ?? [];
    rows.push(split);
    splitsByTxn.set(split.transactionId, rows);
  }
  const byPair = new Map<string, { category: string; amount: number; groupKey: string | null; categoryKey: string | null }>();
  const add = (groupKey: string | null, categoryKey: string | null, amount: number): void => {
    const key = `${groupKey ?? ""}|${categoryKey ?? ""}`;
    const existing = byPair.get(key);
    if (existing) existing.amount = round2(existing.amount + amount);
    else {
      byPair.set(key, {
        category: categoryKey ?? groupKey ?? "UNCATEGORIZED",
        amount: round2(amount),
        groupKey,
        categoryKey,
      });
    }
  };
  for (const txn of txns) {
    const rows = splitsByTxn.get(txn.id);
    if (
      rows &&
      validateSplits(
        { id: txn.id, amount: txn.amount, category: txn.pfc_primary ?? "UNCATEGORIZED" },
        rows,
      ).valid
    ) {
      for (const split of rows) add(null, split.category, split.amount);
    } else {
      add(txn.pfc_primary, txn.pfc_detailed, Math.abs(txn.amount));
    }
  }
  return [...byPair.values()];
}

/**
 * The caller's own preference row, which holds the Accounts page's net-worth
 * exclusions. Always keyed on `id` even under household scope: the exclusion
 * list belongs to the person looking, not to the rows they can see. Without a
 * userId the RLS-bound client already sees only its own profile.
 */
function ownProfilePrefsQuery(supabase: SupabaseClient, userId: string | undefined) {
  const query = supabase.from("profiles").select("dashboard_prefs");
  return (userId ? query.eq("id", userId) : query).maybeSingle();
}

/**
 * The dashboard's balance sheet, composed exactly as the stored snapshot and
 * the Accounts page compose theirs. A failed input read throws: the live
 * open-month value overwrites a correctly composed snapshot, so an incomplete
 * balance sheet is worse than an error.
 */
function composeDashboardBalanceSheet(
  plaidAccounts: readonly PlaidBalanceRow[],
  manualAccountsResult: QueryResult<unknown>,
  prefsResult: QueryResult<{ dashboard_prefs?: unknown }>,
): NetWorthAccount[] {
  if (manualAccountsResult.error) throw manualAccountsResult.error;
  if (prefsResult.error) throw prefsResult.error;
  return composeNetWorthAccounts({
    plaidAccounts,
    manualAccounts: (manualAccountsResult.data ?? []) as ManualBalanceRow[],
    excludedNetWorthIds: readExcludedNetWorthIds(prefsResult.data?.dashboard_prefs),
  });
}

function assertStage1Success(
  results: readonly [string, { error?: unknown }][],
): void {
  for (const [name, result] of results) {
    if (result.error) {
      throw result.error instanceof Error
        ? new Error(`dashboard stage1 ${name}: ${result.error.message}`, { cause: result.error })
        : result.error;
    }
  }
}

async function fetchWindowTransactions(
  supabase: SupabaseClient,
  activeMonth: string,
  scopeUser: <T>(builder: T) => T,
): Promise<Array<Record<string, unknown>>> {
  const windowStart = `${addMonths(activeMonth, -5)}-01`;
  const windowEndExclusive = `${addMonths(activeMonth, 1)}-01`;
  const txns: Array<Record<string, unknown>> = [];
  for (let page = 0; ; page += 1) {
    const from = page * DASHBOARD_TXN_PAGE_SIZE;
    const result = (await scopeUser(
      supabase
        .from("transactions")
        .select(
          "id, date, amount, merchant_name, name, pfc_primary, pfc_detailed, account_id, user_id, plaid_transaction_id",
        )
        .gte("date", windowStart)
        .lt("date", windowEndExclusive)
        .order("date")
        .order("id")
        .range(from, from + DASHBOARD_TXN_PAGE_SIZE - 1),
    )) as { data: Array<Record<string, unknown>> | null; error: unknown };
    if (result.error) throw result.error;
    const batch = result.data ?? [];
    txns.push(...batch);
    if (batch.length < DASHBOARD_TXN_PAGE_SIZE) break;
  }
  return txns;
}

function buildProjectedTransactions(params: {
  txns: Array<Record<string, unknown>>;
  merchantRules: unknown[] | null;
  categoryOverrideRows: unknown[] | null;
  linkedRefunds: unknown[] | null;
  linkedTransfersRows: unknown[] | null;
  linkedDuplicates: unknown[] | null;
  transactionOverrides: Array<{
    transactionId: string;
    displayCategory: string | null;
    cashFlowClassification: "expense" | "income" | null;
  }>;
  allAccounts: AccountSummary[];
}): { rawRows: RawFinanceTransaction[]; allTxnsRaw: TxnLite[] } {
  const {
    txns,
    merchantRules,
    categoryOverrideRows,
    linkedRefunds,
    linkedTransfersRows,
    linkedDuplicates,
    transactionOverrides,
    allAccounts,
  } = params;

  const accountNamesById = new Map<string, string>();
  for (const a of allAccounts) {
    accountNamesById.set(a.id, a.name || "");
  }

  const rulesList = (merchantRules ?? []).map((r) => {
    const rule = r as {
      match_type: "merchant" | "keyword" | "account";
      pattern: string;
      display_name: string | null;
      category: string | null;
      enabled: boolean;
    };
    return {
      matchType: rule.match_type,
      pattern: rule.pattern,
      displayName: rule.display_name,
      category: rule.category,
      enabled: rule.enabled,
    };
  });

  const rawRows = ((txns ?? []) as unknown as TransactionRow[]).map(fromTransactionRow);
  const rawById = new Map(rawRows.map((row) => [row.id, row]));

  const canonicalTxns = projectFinanceTransactions({
    rows: rawRows,
    merchantRules: rulesList,
    categoryOverrides: ((categoryOverrideRows ?? []) as Array<{
      source_category: string;
      display_category: string;
    }>).map((row) => ({
      sourceCategory: row.source_category,
      displayCategory: row.display_category,
    })),
    splits: [],
    linkedRefunds: ((linkedRefunds ?? []) as Array<{
      charge_transaction_id: string;
      refund_transaction_id: string;
    }>).map((row) => ({
      chargeTransactionId: row.charge_transaction_id,
      refundTransactionId: row.refund_transaction_id,
    })),
    linkedTransfers: ((linkedTransfersRows ?? []) as Array<{
      out_transaction_id: string;
      in_transaction_id: string;
    }>).map((row) => ({
      outTransactionId: row.out_transaction_id,
      inTransactionId: row.in_transaction_id,
    })),
    transactionOverrides,
    excludedTransactionIds: new Set(
      ((linkedDuplicates ?? []) as Array<{ excluded_transaction_id: string }>).map(
        (row) => row.excluded_transaction_id,
      ),
    ),
    accountNames: accountNamesById,
  });

  const allTxnsRaw: TxnLite[] = canonicalTxns.map((row) => {
    const source = rawById.get(row.sourceTransactionId)!;
    return {
      id: row.id,
      date: row.date,
      amount: row.signedAmount,
      merchant_name: row.merchant,
      name: source.name,
      pfc_primary: row.groupKey === UNCATEGORIZED ? null : row.groupKey,
      pfc_detailed: source.pfcDetailed,
      account_id: row.accountId ?? "",
      user_id: source.userId,
      flow: row.flow,
    };
  });

  return { rawRows, allTxnsRaw };
}

function buildSafeToSpendUpcomingExpenses(
  forecastEvents: Array<{ itemType: string; date: string; name: string; amount: number }>,
  sinkingFundItems: Array<{ dueSoon: boolean; dueDate: string; name: string; targetAmount: number }>,
  insightsAsOf: string,
): Array<{ date: string; name: string; amount: number }> {
  return [
    ...forecastEvents
      .filter((event) => event.itemType === "expense")
      .map((event) => ({
        date: event.date,
        name: event.name,
        amount: Math.abs(event.amount),
      })),
    ...sinkingFundItems
      .filter((fund) => fund.dueSoon)
      .map((fund) => ({
        date: fund.dueDate < insightsAsOf ? insightsAsOf : fund.dueDate,
        name: fund.name,
        amount: fund.targetAmount,
      })),
  ];
}

function composeNetWorthHistoryWithLivePoint(params: {
  snapshots: Array<{ snapshot_month: string; assets: number; liabilities: number }>;
  netWorthSnapshot: { assets: number; liabilities: number; netWorth: number };
  currentMonth: string;
  hasBalanceSheet: boolean;
  scope?: string;
}): Array<{ month: string; assets: number; liabilities: number; netWorth: number }> {
  const { snapshots, netWorthSnapshot, currentMonth, hasBalanceSheet, scope } = params;
  const netWorthHistory = snapshots.map((s) => {
    const assets = Number(s.assets ?? 0);
    const liabilities = Number(s.liabilities ?? 0);
    return {
      month: s.snapshot_month.slice(0, 7),
      assets,
      liabilities,
      netWorth: round2(assets - liabilities),
    };
  });

  if (scope !== "household" && hasBalanceSheet) {
    const currentPoint = { month: currentMonth, ...netWorthSnapshot };
    const currentIndex = netWorthHistory.findIndex((point) => point.month === currentMonth);
    if (currentIndex >= 0) netWorthHistory[currentIndex] = currentPoint;
    else netWorthHistory.push(currentPoint);
  }
  netWorthHistory.sort((a, b) => a.month.localeCompare(b.month));
  return netWorthHistory;
}

function getItemAccountIds(accounts: AccountSummary[], itemId?: string): Set<string> | null {
  if (!itemId) return null;
  return new Set(accounts.filter(account => account.plaid_item_id === itemId).map(account => account.id));
}

export async function getDashboardData(
  supabase: SupabaseClient,
  selectedAccountId?: string,
  selectedMonth?: string,
  userId?: string,
  options?: DashboardOptions,
): Promise<DashboardData> {
  // One clock for the whole load (M-11): the viewer's profile-timezone day
  // when the caller knows it, else the server-local day. Every month key,
  // day count, and the live net-worth point below derives from `today`.
  const today = options?.today ?? localDateKey(new Date());
  const currentMonth = today.slice(0, 7);

  // Explicit user scoping. With the user-scoped client this is redundant (RLS
  // already limits rows), but this function is also called under the service
  // client from the notification cron, where RLS is bypassed — there `userId`
  // MUST be passed so every query filters to that user. Every table read below
  // has a `user_id` column.
  const applyUserScope = options?.scope !== "household";
  const scopeUser = <T>(builder: T): T =>
    userId && applyUserScope
      ? (builder as T & { eq(column: string, value: string): T }).eq("user_id", userId)
      : builder;

  // Stage 1: everything except transactions, plus one tiny oldest-date probe.
  // Transactions are then fetched BOUNDED to the 6-month window the dashboard
  // actually renders — with years of history (and a 2-minute auto re-render)
  // an unbounded select-all grows without limit.
  //
  // Every Stage-1 read is error-checked (A-5): a DB failure used to render a
  // dashboard of zeros with no error. The linked_transfers fallback for a
  // missing table lives inside its own query builder below.
  const stage1 = await Promise.all([
    scopeUser(
      supabase
        .from("accounts")
        .select(
          "id, user_id, name, official_name, mask, type, subtype, current_balance, available_balance, credit_limit, iso_currency_code, plaid_item_id, apr",
        )
        .order("name"),
    ),
    loadRecurringInputs(supabase, applyUserScope ? userId : undefined),
    scopeUser(supabase.from("plaid_items").select("id, institution_name")),
    scopeUser(supabase.from("budgets").select("category, monthly_limit, group_name, rollover_enabled")),
    scopeUser(
      supabase
        .from("sync_jobs")
        .select("updated_at")
        .eq("status", "done")
        .eq("job_type", "transactions")
        .order("updated_at", { ascending: false })
        .limit(1),
    ).maybeSingle(),
    scopeUser(
      supabase
        .from("transactions")
        .select("date")
        .order("date", { ascending: true })
        .limit(1),
    ).maybeSingle(),
    scopeUser(
      supabase
        .from("merchant_rules")
        .select("match_type, pattern, display_name, category, enabled")
        .order("created_at"),
    ),
    scopeUser(
      supabase
        .from("net_worth_snapshots")
        .select("snapshot_month, assets, liabilities")
        .order("snapshot_month", { ascending: true }),
    ),
    scopeUser(
      supabase
        .from("linked_refunds")
        .select("charge_transaction_id, refund_transaction_id"),
    ),
    Promise.resolve(
      scopeUser(
        supabase
          .from("linked_transfers")
          .select("out_transaction_id, in_transaction_id"),
      ),
    )
      .then((res: { data?: unknown; error?: unknown }) => {
        if (
          res?.error &&
          ((res.error as { code?: string }).code === "42P01" ||
            (res.error as { message?: string }).message?.includes("linked_transfers"))
        ) {
          return { data: [] as Array<{ out_transaction_id: string; in_transaction_id: string }>, error: null };
        }
        return res;
      })
      .catch((error: unknown) => {
        if (
          (error instanceof Error &&
            (error.message.includes("42P01") || error.message.includes("linked_transfers"))) ||
          (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error as { code: string }).code === "42P01")
        ) {
          return { data: [] as Array<{ out_transaction_id: string; in_transaction_id: string }>, error: null };
        }
        throw error;
      }),
    scopeUser(
      supabase
        .from("linked_duplicates")
        .select("excluded_transaction_id"),
    ),
    scopeUser(
      supabase
        .from("category_overrides")
        .select("source_category, display_category"),
    ),
    scopeUser(
      supabase
        .from("sinking_funds")
        .select("name, target_amount, due_date, cadence, custom_interval_months, cycle_anchor_date")
        .order("due_date"),
    ),
    // Scheduled one-off entries feed the forecast and bill calendar so a
    // committed future payment shows in the projection before it hits the
    // ledger. Bounded to the dashboard's window of interest.
    scopeUser(
      supabase
        .from("scheduled_transactions")
        .select("kind, amount, merchant, scheduled_date, category")
        .eq("status", "scheduled")
        .gte("scheduled_date", `${currentMonth}-01`)
        .order("scheduled_date")
        .limit(100),
    ),
    // Balance-sheet inputs beyond the connected accounts. Net worth has to
    // agree with the Accounts page and with the stored monthly snapshot, and
    // both of those count manual accounts and drop the user's exclusions.
    options?.includeBalanceSheet !== false
      ? scopeUser(
          supabase
            .from("manual_accounts")
            .select("id, name, account_type, balance, include_in_net_worth"),
        )
      : Promise.resolve({ data: [], error: null }),
    options?.includeBalanceSheet !== false
      ? ownProfilePrefsQuery(supabase, userId)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const [
    accountsResult,
    recurringInputs,
    itemsResult,
    budgetsResult,
    lastSyncJobResult,
    oldestTxnResult,
    merchantRulesResult,
    snapshotsResult,
    linkedRefundsResult,
    linkedTransfers,
    linkedDuplicatesResult,
    categoryOverrideRowsResult,
    sinkingFundRowsResult,
    scheduledRowsResult,
    manualAccountsResult,
    netWorthPrefsResult,
  ] = stage1;
  assertStage1Success([
    ["accounts", accountsResult],
    ["plaid_items", itemsResult],
    ["budgets", budgetsResult],
    ["sync_jobs", lastSyncJobResult],
    ["transactions_probe", oldestTxnResult],
    ["merchant_rules", merchantRulesResult],
    ["net_worth_snapshots", snapshotsResult],
    ["linked_refunds", linkedRefundsResult],
    ["linked_duplicates", linkedDuplicatesResult],
    ["category_overrides", categoryOverrideRowsResult],
    ["sinking_funds", sinkingFundRowsResult],
    ["scheduled_transactions", scheduledRowsResult],
  ]);
  const accounts = accountsResult.data;
  const items = itemsResult.data;
  const budgets = budgetsResult.data;
  const lastSyncJob = lastSyncJobResult.data;
  const oldestTxn = oldestTxnResult.data;
  const merchantRules = merchantRulesResult.data;
  const snapshots = snapshotsResult.data;
  const linkedRefunds = linkedRefundsResult.data;
  if (linkedTransfers.error) throw linkedTransfers.error;
  const linkedTransfersRows = linkedTransfers.data as unknown[] | null;
  const linkedDuplicates = linkedDuplicatesResult.data;
  const categoryOverrideRows = categoryOverrideRowsResult.data;
  const sinkingFundRows = sinkingFundRowsResult.data;
  const scheduledRows = scheduledRowsResult.data;

  const allAccounts = ((accounts ?? []) as AccountSummary[]).map((account) => ({
    ...account,
    name: normalizeExternalDisplayText(account.name),
    official_name: normalizeExternalDisplayText(account.official_name),
  }));
  const netWorthAccounts =
    options?.includeBalanceSheet !== false
      ? composeDashboardBalanceSheet(
          allAccounts,
          manualAccountsResult,
          netWorthPrefsResult,
        )
      : [];
  const lastSyncAt = (lastSyncJob?.updated_at as string | undefined) ?? null;
  const allItems = (items ?? []) as Array<{ id: string; institution_name: string | null }>;
  const allBudgets = (budgets ?? []) as Array<{
    category: string;
    monthly_limit: number;
    group_name: string;
    rollover_enabled?: boolean | null;
  }>;
  const allSnapshots = (snapshots ?? []) as Array<{ snapshot_month: string; assets: number; liabilities: number }>;

  // Month browser: a continuous range from the oldest transaction to today
  // (empty months render as zeros — still browsable).
  const oldestMonth = oldestTxn ? monthKey(oldestTxn.date as string) : currentMonth;
  const availableMonths = enumerateMonths(currentMonth, oldestMonth);

  // Determine active month
  const activeMonth =
    selectedMonth && availableMonths.includes(selectedMonth)
      ? selectedMonth
      : currentMonth;

  // Stage 2: transactions for the rendered window only — the active month,
  // the five months before it (charts), including the pro-rated comparison.
  // Paged with .range() (A-5): PostgREST silently truncates an unpaged read
  // at max_rows (1,000), which produced wrong spend totals, envelopes, and
  // cron alerts with no error once a ledger passed ~165 txns/month.
  const txns = await fetchWindowTransactions(supabase, activeMonth, scopeUser);

  // Per-transaction classification overrides for the rendered window, so the
  // dashboard agrees with every other canonical surface about the same rows.
  const txnIds = ((txns ?? []) as Array<{ id: string }>).map((row) => row.id);
  const overrideRows = await loadDashboardOverrides(
    supabase,
    txnIds,
    userId,
    applyUserScope,
  );
  const transactionOverrides = overrideRows.map((row) => ({
    transactionId: row.transaction_id,
    displayCategory: row.display_category,
    cashFlowClassification:
      row.cash_flow_classification === "expense" || row.cash_flow_classification === "income"
        ? row.cash_flow_classification
        : null,
  }));

  const { allTxnsRaw } = buildProjectedTransactions({
    txns,
    merchantRules,
    categoryOverrideRows,
    linkedRefunds,
    linkedTransfersRows,
    linkedDuplicates,
    transactionOverrides,
    allAccounts,
  });

  // Filter transactions by selected account and/or bank (plaid item)
  const itemAccountIds = getItemAccountIds(allAccounts, options?.itemId);
  const filteredTxns = allTxnsRaw.filter(
    (t) =>
      (!selectedAccountId || t.account_id === selectedAccountId) &&
      (!itemAccountIds || itemAccountIds.has(t.account_id)),
  );

  // Linked refund pairs already carry flow "transfer" from the projection: a
  // fully-refunded purchase is neither spend nor income, so both halves fall
  // out of spend/income/category/merchant/card/bank totals. Cash-flow (literal
  // depository money movement) and the ledger list still show them.
  const spendTxns = filteredTxns;

  const activeYear = Number(activeMonth.split("-")[0]);
  const activeMonthIndex = Number(activeMonth.split("-")[1]) - 1;
  const aggregates = aggregateDashboardTransactions(spendTxns, allTxnsRaw, allAccounts, activeMonth);
  const {
    monthlySpending,
    monthlyIncome,
    monthlyCashFlow,
    merchantMap,
    categoryHistoryMap,
    currentMonthExpenses,
    currentMonthIncome,
    activeMonthSpend,
    windowSpendTxns,
    windowSpendMerchants,
  } = aggregates;

  // Split-aware category totals: when a transaction has splits that sum to its
  // amount, its spend is distributed across the split categories instead of its
  // single Plaid category. Whole-transaction category is used when there are no
  // (valid) splits, so this is a no-op until a user adds splits.
  const activeSpendIds = activeMonthSpend.map((t) => t.id);
  const { data: splitRows } = activeSpendIds.length
    ? await scopeUser(
        supabase
          .from("transaction_splits")
          .select("transaction_id, category, amount")
          .in("transaction_id", activeSpendIds),
      )
    : { data: [] as Array<{ transaction_id: string; category: string; amount: number }> };
  const splits = (splitRows ?? []).map((s) => ({
    transactionId: s.transaction_id as string,
    category: s.category as string,
    amount: Number(s.amount),
  }));
  const categoryBreakdown = aggregateSpendWithSplits(
    activeMonthSpend.map((t) => ({ id: t.id, amount: t.amount, category: t.pfc_primary })),
    splits,
  );

  const drilldown = buildDashboardDrilldown(
    options?.drill,
    windowSpendTxns,
    splits,
    monthlySpending,
    activeMonth,
    windowSpendMerchants,
  );

  const merchantBreakdown = [...merchantMap.entries()]
    .map(([merchant, amount]) => ({ merchant, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  // 1. Total Budget Limit calculation
  const totalBudget = allBudgets.reduce((acc, b) => acc + b.monthly_limit, 0);

  // Day counts from the same `today` as the month key (M-11): parsing the
  // YYYY-MM-DD string keeps every comparison in calendar space.
  const todayDay = Number(today.slice(8, 10));
  const isCurrentMonth = today.slice(0, 7) === activeMonth;
  const spendMetrics = buildDashboardSpendMetrics({
    spendTxns,
    allTxnsRaw,
    allAccounts,
    allItems,
    activeMonth,
    lastMonthTargetDay:
      isCurrentMonth ? todayDay : new Date(activeYear, activeMonthIndex + 1, 0).getDate(),
    activeYear,
    activeMonthIndex,
  });
  const { lastMonthProratedSpent, spendPerCard, spendPerBank, cashFlow } = spendMetrics;

  const activeDay =
    isCurrentMonth ? todayDay : new Date(activeYear, activeMonthIndex + 1, 0).getDate();
  const activeDaysInMonth = new Date(activeYear, activeMonthIndex + 1, 0).getDate();
  // Income-group budgets are not expense envelopes (M-12): the groups
  // builder drops them, so the envelopes must never contain them either.
  const expenseBudgets = allBudgets.filter((budget) => budget.group_name !== "income");
  const budgetEnvelopes = buildBudgetEnvelopes({
    budgets: expenseBudgets.map((budget) => ({
      category: budget.category,
      monthlyLimit: Number(budget.monthly_limit),
      rolloverEnabled: Boolean(budget.rollover_enabled),
    })),
    windowMonths: monthlySpending
      .map((m) => m.month)
      .filter((m) => m !== activeMonth),
    currentSpend: toEnvelopeSpendRows(activeMonthSpend, splits),
    previousSpend: [...(() => {
      const byMonth = new Map<string, Pick<TxnLite, "id" | "amount" | "pfc_primary" | "pfc_detailed">[]>();
      for (const txn of spendTxns) {
        if (!isSpending(txn)) continue;
        const month = monthKey(txn.date);
        if (month === activeMonth) continue;
        const rows = byMonth.get(month) ?? [];
        rows.push(txn);
        byMonth.set(month, rows);
      }
      return [...byMonth.entries()].flatMap(([month, rows]) =>
        toEnvelopeSpendRows(rows, []).map((row) => ({ ...row, month })),
      );
    })()],
    dayOfMonth: activeDay,
    daysInMonth: activeDaysInMonth,
  });
  const budgetGroups = buildDashboardBudgetGroups(
    expenseBudgets.map((budget) => ({
      category: budget.category,
      groupName: budget.group_name,
    })),
    budgetEnvelopes,
  );

  const allowedStreamIds = new Set(recurringInputs.streamRows
    .filter(stream => (!selectedAccountId || stream.account_id === selectedAccountId)
      && (!itemAccountIds || itemAccountIds.has(stream.account_id ?? "")))
    .map(stream => stream.id));
  const recurring = buildDashboardRecurring({
    streams: recurringInputs.streamInputs.filter(stream => allowedStreamIds.has(stream.id)),
    manualItems: selectedAccountId || options?.itemId ? [] : recurringInputs.manualInputs,
    scheduled: ((scheduledRows ?? []) as Array<{
      kind: string; amount: number | string; merchant: string; scheduled_date: string; category: string | null;
    }>).map(toRecurringItem),
    month: activeMonth,
    today,
  });
  const { subscriptions, incomeStreams, recurringStatuses, items: recurringItems } = recurring;
  // Liquid cash in the forecast currency (M-10): null when any depository
  // balance is unknown (a coerced 0 would fake runway and Safe-to-Spend),
  // and non-USD balances are excluded rather than summed as dollars, the
  // same partition lib/forecasting.ts applies.
  const depositoryAccounts = allAccounts.filter((account) => account.type === "depository");
  const cashBalance = depositoryAccounts.some(
    (account) => account.current_balance === null || account.current_balance === undefined,
  )
    ? null
    : round2(
        depositoryAccounts
          .filter((account) => {
            const currency = account.iso_currency_code?.toUpperCase();
            return !currency || currency === "USD";
          })
          .reduce((sum, account) => sum + Number(account.current_balance ?? 0), 0),
      );
  const cashFlowForecast = forecastCashFlow({
    // The forecast needs a number: an unknown balance degrades to an
    // explicitly zero-based projection while runway and Safe-to-Spend,
    // which take `cashBalance` directly, honestly report unknown.
    startingBalance: cashBalance ?? 0,
    asOf: monthDate(activeMonth, activeDay),
    horizonDays: 30,
    items: recurring.forecastItems,
    lowBalanceThreshold: 500,
  });
  const recurringWeeks = groupRecurringByWeek(recurringItems, monthDate(activeMonth, 1), 31);

  // Financial-intelligence derivations — pure math over data already in
  // memory; no extra queries, no Plaid calls (the auto re-render multiplies
  // whatever this costs, so it must stay free).
  const insightsAsOf = monthDate(activeMonth, activeDay);
  const essentialsSplit = splitEssentialsByMonth(
    spendTxns.filter(isSpending).map((t) => ({
      month: monthKey(t.date),
      pfcPrimary: t.pfc_primary,
      pfcDetailed: t.pfc_detailed,
      amount: t.amount,
    })),
    monthlySpending.map((m) => m.month),
  );
  const savingsRateSeries = computeSavingsRateSeries(monthlyIncome, monthlySpending);
  const runwayMonths = computeRunwayMonths({
    liquidBalance: cashBalance,
    // The current calendar month is partial and would drag the median down.
    monthlyEssentials: essentialsSplit
      .filter((row) => row.month !== currentMonth)
      .map((row) => row.essentials),
  });
  const paychecks = detectPaychecks({
    incomeStreams: incomeStreams.map((stream) => ({
      name: stream.merchant,
      amount: stream.amount,
      frequency: normalizeFrequency(stream.frequency),
    })),
    incomeTransactions: filteredTxns.filter(isIncome).map((t) => ({
      date: t.date,
      merchant: extractMerchantName(t, ""),
      amount: t.amount,
    })),
    asOf: insightsAsOf,
  });
  // Sinking funds: planned irregular expenses spread into a monthly
  // set-aside; funds due soon count as upcoming bills in Safe-to-Spend
  // (past-due dates clamp to today so they aren't silently dropped).
  const sinkingFunds = computeSinkingFunds({
    funds: ((sinkingFundRows ?? []) as Array<{
      name: string;
      target_amount: number;
      due_date: string;
      cadence: SinkingFundInput["cadence"];
      custom_interval_months: number | null;
      cycle_anchor_date: string;
    }>).map((row) => ({
      name: row.name,
      targetAmount: Number(row.target_amount),
      dueDate: row.due_date,
      cadence: row.cadence,
      customIntervalMonths: row.custom_interval_months,
      cycleAnchorDate: row.cycle_anchor_date,
    })),
    asOf: insightsAsOf,
  });

  const safeToSpend = computeSafeToSpend({
    cashBalance,
    asOf: insightsAsOf,
    nextPayDate: paychecks.primary?.nextPayDate ?? null,
    upcomingExpenses: buildSafeToSpendUpcomingExpenses(
      cashFlowForecast.events,
      sinkingFunds.items,
      insightsAsOf,
    ),
  });

  const priorCategoryAverages = [...categoryHistoryMap.entries()]
    .map(([key, amount]) => {
      const [month, category] = key.split("|");
      return { month: month!, category: category!, amount };
    })
    .filter((row) => row.month !== activeMonth)
    .reduce((map, row) => {
      const values = map.get(row.category) ?? [];
      values.push(row.amount);
      map.set(row.category, values);
      return map;
    }, new Map<string, number[]>());
  const spendPerPerson = computeSpendPerPerson(spendTxns, activeMonth, userId, options?.scope);

  // Bill calendar (1.8): expand recurring occurrences over the horizon. The
  // items already use Plaid's prediction when available and retain the legacy
  // transaction-based and mid-month fallbacks otherwise.
  const billPeriods = {
    weekly: groupRecurringByPeriod(recurringItems, insightsAsOf, 35, "weekly"),
    monthly: groupRecurringByPeriod(recurringItems, insightsAsOf, 62, "monthly"),
  };

  // Personal price drift (1.9): recent 3-month vs prior 3-month average
  // charge per repeat merchant.
  const priceDrift = computeMerchantPriceDrift({
    txns: spendTxns.filter(isSpending).map((t) => ({
      date: t.date,
      merchant: extractMerchantName(t),
      amount: t.amount,
    })),
    asOfMonth: activeMonth,
  });

  const debt = buildDebtSummary(allAccounts);
  const priorMerchantMedians = computePriorMerchantMedians(spendTxns, activeMonth);
  const spendingAnomalies = detectSpendingAnomalies({
    currentTransactions: filteredTxns
      .filter((t) => monthKey(t.date) === activeMonth && isSpending(t))
      .map((t) => ({
        id: `${t.date}-${t.account_id}-${extractMerchantName(t, "txn")}-${t.amount}`,
        date: t.date,
        merchant: extractMerchantName(t),
        category: t.pfc_primary ?? "UNCATEGORIZED",
        amount: t.amount,
      })),
    priorCategoryAverages: [...priorCategoryAverages.entries()].map(([category, values]) => ({
      category,
      amount: round2(values.reduce((sum, value) => sum + value, 0) / values.length),
    })),
    priorMerchantMedians,
    largeTransactionThreshold: 500,
  });
  const netWorthSnapshot = computeNetWorthSnapshot(netWorthAccounts);

  const hasBalanceSheet = netWorthAccounts.some((account) => account.balance !== null);
  const netWorthHistory = composeNetWorthHistoryWithLivePoint({
    snapshots: allSnapshots,
    netWorthSnapshot,
    currentMonth,
    hasBalanceSheet,
    scope: options?.scope,
  });

  return {
    accounts: allAccounts,
    creditAccounts: allAccounts.filter((a) => a.type === "credit"),
    monthlySpending,
    monthlyIncome,
    monthlyCashFlow,
    categoryBreakdown,
    merchantBreakdown,
    currentMonthExpenses: round2(currentMonthExpenses),
    currentMonthIncome: round2(currentMonthIncome),
    subscriptions,
    incomeStreams,
    availableMonths,
    selectedMonth: activeMonth,
    today,
    lastSyncAt,
    lastSyncAgoMinutes: lastSyncAt
      ? Math.max(0, Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / 60000))
      : null,
    syncIsStale:
      allItems.length > 0 &&
      (!lastSyncAt ||
        Date.now() - new Date(lastSyncAt).getTime() > STALE_AFTER_MS),
    totalBudget: round2(totalBudget),
    lastMonthProratedSpent: round2(lastMonthProratedSpent),
    spendPerCard,
    spendPerBank,
    cashFlow,
    budgetEnvelopes,
    budgetGroups,
    cashFlowForecast,
    recurringWeeks,
    spendingAnomalies,
    netWorthSnapshot,
    netWorthHistory,
    recurringStatuses,
    spendPerPerson,
    billPeriods,
    insights: {
      savingsRateSeries,
      essentialsSplit,
      runwayMonths,
      paycheck: paychecks.primary,
      safeToSpend,
      priceDrift,
      sinkingFunds,
      debt,
    },
    drilldown,
    drillableMerchants: [...windowSpendMerchants],
  };
}

export {
  type CumulativeSpendDay,
  daysInMonth,
  computeCumulativeSpendByDay,
} from "@/lib/cumulative-spend";
