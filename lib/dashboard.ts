import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyMerchantRules,
  buildBudgetEnvelopes,
  computeNetWorthSnapshot,
  detectSpendingAnomalies,
  forecastCashFlow,
  groupRecurringByWeek,
  type BudgetEnvelope,
  type CashFlowForecast,
  type SpendingAnomaly,
} from "@/lib/planning";

/**
 * Aggregations for the dashboard. Runs with the caller's user-scoped Supabase
 * client, so RLS guarantees only the current user's rows are visible.
 *
 * Sign convention (Plaid): positive amount = money out (spending),
 * negative = money in (income). Transfers are excluded from spend/income totals.
 */

export const EXCLUDED_PFC = new Set([
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
]);

export interface AccountSummary {
  id: string;
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
  }[];
  incomeStreams: { merchant: string; amount: number; frequency: string | null }[];
  availableMonths: string[];
  selectedMonth: string;
  /** Completion time of the newest successful sync job, or null if none. */
  lastSyncAt: string | null;
  /** Whole minutes since lastSyncAt (null when never synced). */
  lastSyncAgoMinutes: number | null;
  /** True when banks are connected but no sync has succeeded in 48h. */
  syncIsStale: boolean;
  totalBudget: number;
  lastMonthProratedSpent: number;
  spendPerCard: { name: string; amount: number }[];
  spendPerBank: { name: string; amount: number }[];
  cashFlow: { deposits: number; withdrawals: number; net: number };
  budgetEnvelopes: BudgetEnvelope[];
  cashFlowForecast: CashFlowForecast;
  recurringWeeks: ReturnType<typeof groupRecurringByWeek>;
  spendingAnomalies: SpendingAnomaly[];
  netWorthSnapshot: { assets: number; liabilities: number; netWorth: number };
  netWorthHistory: { month: string; assets: number; liabilities: number; netWorth: number }[];
}

interface TxnLite {
  id: string;
  date: string;
  amount: number;
  merchant_name: string | null;
  name: string | null;
  pfc_primary: string | null;
  account_id: string;
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
  return t.amount > 0 && !EXCLUDED_PFC.has(t.pfc_primary ?? "");
}

function isIncome(t: TxnLite): boolean {
  return t.amount < 0 && !EXCLUDED_PFC.has(t.pfc_primary ?? "");
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

export async function getDashboardData(
  supabase: SupabaseClient,
  selectedAccountId?: string,
  selectedMonth?: string,
): Promise<DashboardData> {
  const now = new Date();
  const currentMonth = monthKey(now.toISOString().slice(0, 10));

  // Stage 1: everything except transactions, plus one tiny oldest-date probe.
  // Transactions are then fetched BOUNDED to the 6-month window the dashboard
  // actually renders — with years of history (and a 2-minute auto re-render)
  // an unbounded select-all grows without limit.
  const [
    { data: accounts },
    { data: streams },
    { data: items },
    { data: budgets },
    { data: lastSyncJob },
    { data: oldestTxn },
    { data: merchantRules },
    { data: snapshots },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select(
        "id, name, official_name, mask, type, subtype, current_balance, available_balance, credit_limit, iso_currency_code, plaid_item_id",
      )
      .order("name"),
    supabase
      .from("recurring_streams")
      .select("merchant_name, description, average_amount, frequency, category, stream_type, is_active, plaid_item_id")
      .eq("is_active", true),
    supabase
      .from("plaid_items")
      .select("id, institution_name"),
    supabase
      .from("budgets")
      .select("category, monthly_limit"),
    supabase
      .from("sync_jobs")
      .select("updated_at")
      .eq("status", "done")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("transactions")
      .select("date")
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("merchant_rules")
      .select("match_type, pattern, display_name, category, enabled")
      .order("created_at"),
    supabase
      .from("net_worth_snapshots")
      .select("snapshot_month, assets, liabilities")
      .order("snapshot_month", { ascending: true }),
  ]);

  const allAccounts = (accounts ?? []) as AccountSummary[];
  const lastSyncAt = (lastSyncJob?.updated_at as string | undefined) ?? null;
  const allItems = (items ?? []) as Array<{ id: string; institution_name: string | null }>;
  const allBudgets = (budgets ?? []) as Array<{ category: string; monthly_limit: number }>;
  const allRules = (merchantRules ?? []) as any[];
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
  const windowStart = `${addMonths(activeMonth, -5)}-01`;
  const windowEndExclusive = `${addMonths(activeMonth, 1)}-01`;
  const { data: txns } = await supabase
    .from("transactions")
    .select("id, date, amount, merchant_name, name, pfc_primary, account_id")
    .gte("date", windowStart)
    .lt("date", windowEndExclusive);

  const allTxnsRawUncleaned = (txns ?? []) as TxnLite[];

  const accountNamesById = new Map<string, string>();
  for (const a of allAccounts) {
    accountNamesById.set(a.id, a.name || "");
  }

  const cleanupTxns = allTxnsRawUncleaned.map((t) => ({
    id: t.id,
    merchant: t.merchant_name ?? t.name ?? "",
    category: t.pfc_primary,
    accountName: accountNamesById.get(t.account_id) || "",
  }));

  const rulesList = (merchantRules ?? []).map((r) => ({
    matchType: r.match_type as "merchant" | "keyword" | "account",
    pattern: r.pattern,
    displayName: r.display_name,
    category: r.category,
    enabled: r.enabled,
  }));

  const appliedTxns = applyMerchantRules(cleanupTxns, rulesList);

  const allTxnsRaw = allTxnsRawUncleaned.map((t, index) => {
    const clean = appliedTxns[index]!;
    return {
      ...t,
      merchant_name: clean.merchant,
      pfc_primary: clean.category,
    };
  });

  // Filter transactions by selected account if specified
  const filteredTxns = selectedAccountId
    ? allTxnsRaw.filter((t) => t.account_id === selectedAccountId)
    : allTxnsRaw;

  // Per-month aggregates (spending, income, depository cash flow) for the
  // 6-month window ending at activeMonth. One account-type lookup map keeps
  // the cash-flow pass linear.
  const accountTypeById = new Map<string, string | null>();
  for (const a of allAccounts) accountTypeById.set(a.id, a.type);

  const monthMap = new Map<string, number>();
  const incomeMap = new Map<string, number>();
  for (const t of filteredTxns) {
    const key = monthKey(t.date);
    if (isSpending(t)) {
      monthMap.set(key, (monthMap.get(key) ?? 0) + t.amount);
    } else if (isIncome(t)) {
      incomeMap.set(key, (incomeMap.get(key) ?? 0) + Math.abs(t.amount));
    }
  }

  const depositsMap = new Map<string, number>();
  const withdrawalsMap = new Map<string, number>();
  for (const t of allTxnsRaw) {
    if (accountTypeById.get(t.account_id) !== "depository") continue;
    const key = monthKey(t.date);
    if (t.amount < 0) {
      depositsMap.set(key, (depositsMap.get(key) ?? 0) + Math.abs(t.amount));
    } else {
      withdrawalsMap.set(key, (withdrawalsMap.get(key) ?? 0) + t.amount);
    }
  }

  // Generate last 6 months relative to activeMonth to render in the charts
  const activeYear = Number(activeMonth.split("-")[0]);
  const activeMonthIndex = Number(activeMonth.split("-")[1]) - 1;
  const monthlySpending: { month: string; amount: number }[] = [];
  const monthlyIncome: { month: string; amount: number }[] = [];
  const monthlyCashFlow: { month: string; deposits: number; withdrawals: number }[] = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(activeYear, activeMonthIndex - i, 15);
    const key = monthKey(d.toISOString().slice(0, 10));
    monthlySpending.push({
      month: key,
      amount: round2(monthMap.get(key) ?? 0),
    });
    monthlyIncome.push({
      month: key,
      amount: round2(incomeMap.get(key) ?? 0),
    });
    monthlyCashFlow.push({
      month: key,
      deposits: round2(depositsMap.get(key) ?? 0),
      withdrawals: round2(withdrawalsMap.get(key) ?? 0),
    });
  }

  // Active-month breakdowns and income/expense totals
  const categoryMap = new Map<string, number>();
  const merchantMap = new Map<string, number>();
  const categoryHistoryMap = new Map<string, number>();
  let currentMonthExpenses = 0;
  let currentMonthIncome = 0;

  for (const t of filteredTxns) {
    if (isSpending(t)) {
      const historyKey = `${monthKey(t.date)}|${t.pfc_primary ?? "UNCATEGORIZED"}`;
      categoryHistoryMap.set(historyKey, (categoryHistoryMap.get(historyKey) ?? 0) + t.amount);
    }
    if (monthKey(t.date) !== activeMonth) continue;
    if (isSpending(t)) {
      currentMonthExpenses += t.amount;
      const cat = t.pfc_primary ?? "UNCATEGORIZED";
      categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + t.amount);
      const merch = t.merchant_name ?? t.name ?? "Unknown";
      merchantMap.set(merch, (merchantMap.get(merch) ?? 0) + t.amount);
    } else if (isIncome(t)) {
      currentMonthIncome += Math.abs(t.amount);
    }
  }

  const categoryBreakdown = [...categoryMap.entries()]
    .map(([category, amount]) => ({ category, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);

  const merchantBreakdown = [...merchantMap.entries()]
    .map(([merchant, amount]) => ({ merchant, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  // 1. Total Budget Limit calculation
  const totalBudget = allBudgets.reduce((acc, b) => acc + b.monthly_limit, 0);

  // 2. Pro-rated last month spending calculation
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === activeYear && today.getMonth() === activeMonthIndex;
  const targetDay = isCurrentMonth ? today.getDate() : new Date(activeYear, activeMonthIndex + 1, 0).getDate();

  const lastMonthDate = new Date(activeYear, activeMonthIndex - 1, 15);
  const lastMonthKey = monthKey(lastMonthDate.toISOString().slice(0, 10));

  let lastMonthProratedSpent = 0;
  for (const t of filteredTxns) {
    if (monthKey(t.date) !== lastMonthKey) continue;
    const tDay = Number(t.date.split("-")[2]);
    if (tDay <= targetDay && isSpending(t)) {
      lastMonthProratedSpent += t.amount;
    }
  }

  // 3. Spend Per Card calculation for the active month
  const cardSpendMap = new Map<string, number>();
  for (const t of filteredTxns) {
    if (monthKey(t.date) !== activeMonth || !isSpending(t)) continue;
    cardSpendMap.set(t.account_id, (cardSpendMap.get(t.account_id) ?? 0) + t.amount);
  }
  const spendPerCard = [...cardSpendMap.entries()]
    .map(([acctId, amount]) => {
      const acct = allAccounts.find((a) => a.id === acctId);
      const displayName = acct ? `${acct.name ?? "Account"}${acct.mask ? ` ••${acct.mask}` : ""}` : "Unknown Account";
      return { name: displayName, amount: round2(amount) };
    })
    .sort((a, b) => b.amount - a.amount);

  // 4. Spend Per Bank calculation for the active month
  const bankSpendMap = new Map<string, number>();
  for (const t of filteredTxns) {
    if (monthKey(t.date) !== activeMonth || !isSpending(t)) continue;
    const acct = allAccounts.find((a) => a.id === t.account_id);
    const bankName = acct
      ? (allItems.find((i) => i.id === acct.plaid_item_id)?.institution_name ?? "Other Bank")
      : "Unknown Bank";
    bankSpendMap.set(bankName, (bankSpendMap.get(bankName) ?? 0) + t.amount);
  }
  const spendPerBank = [...bankSpendMap.entries()]
    .map(([name, amount]) => ({ name, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);

  // 5. Checking account cash flow aggregates for the active month
  let cashFlowDeposits = 0;
  let cashFlowWithdrawals = 0;
  for (const t of allTxnsRaw) {
    if (monthKey(t.date) !== activeMonth) continue;
    const acct = allAccounts.find((a) => a.id === t.account_id);
    if (acct?.type === "depository") {
      if (t.amount < 0) {
        cashFlowDeposits += Math.abs(t.amount);
      } else {
        cashFlowWithdrawals += t.amount;
      }
    }
  }
  const cashFlow = {
    deposits: round2(cashFlowDeposits),
    withdrawals: round2(cashFlowWithdrawals),
    net: round2(cashFlowDeposits - cashFlowWithdrawals),
  };

  // Filter streams by selected account's plaid item if specified
  const selectedAccountObj = allAccounts.find((a) => a.id === selectedAccountId);
  const selectedItemDbId = selectedAccountObj?.plaid_item_id;

  const streamRows = (streams ?? []) as Array<{
    merchant_name: string | null;
    description: string | null;
    average_amount: number | null;
    frequency: string | null;
    category: string | null;
    stream_type: string;
    plaid_item_id: string;
  }>;

  const filteredStreams = selectedItemDbId
    ? streamRows.filter((s) => s.plaid_item_id === selectedItemDbId)
    : streamRows;

  const subscriptions = filteredStreams
    .filter((s) => s.stream_type === "outflow")
    .map((s) => ({
      merchant: s.merchant_name ?? s.description ?? "Unknown",
      amount: round2(Math.abs(s.average_amount ?? 0)),
      frequency: s.frequency,
      category: s.category,
    }))
    .sort((a, b) => b.amount - a.amount);

  const incomeStreams = filteredStreams
    .filter((s) => s.stream_type === "inflow")
    .map((s) => ({
      merchant: s.merchant_name ?? s.description ?? "Unknown",
      amount: round2(Math.abs(s.average_amount ?? 0)),
      frequency: s.frequency,
    }))
    .sort((a, b) => b.amount - a.amount);

  const activeDay =
    isCurrentMonth ? today.getDate() : new Date(activeYear, activeMonthIndex + 1, 0).getDate();
  const activeDaysInMonth = new Date(activeYear, activeMonthIndex + 1, 0).getDate();
  const budgetEnvelopes = buildBudgetEnvelopes({
    budgets: allBudgets.map((budget) => ({
      category: budget.category,
      monthlyLimit: Number(budget.monthly_limit),
    })),
    currentSpend: categoryBreakdown.map((row) => ({
      category: row.category,
      amount: row.amount,
    })),
    previousSpend: [...categoryHistoryMap.entries()]
      .map(([key, amount]) => {
        const [month, category] = key.split("|");
        return { month: month!, category: category!, amount: round2(amount) };
      })
      .filter((row) => row.month !== activeMonth),
    dayOfMonth: activeDay,
    daysInMonth: activeDaysInMonth,
  });

  const recurringItems = [
    ...subscriptions.map((stream) => ({
      name: stream.merchant,
      amount: stream.amount,
      frequency: normalizeFrequency(stream.frequency),
      itemType: "expense" as const,
      nextDate: monthDate(activeMonth, 15),
      category: stream.category,
    })),
    ...incomeStreams.map((stream) => ({
      name: stream.merchant,
      amount: stream.amount,
      frequency: normalizeFrequency(stream.frequency),
      itemType: "income" as const,
      nextDate: monthDate(activeMonth, 15),
    })),
  ];
  const cashBalance = allAccounts
    .filter((account) => account.type === "depository")
    .reduce((sum, account) => sum + Number(account.current_balance ?? 0), 0);
  const cashFlowForecast = forecastCashFlow({
    startingBalance: cashBalance,
    asOf: monthDate(activeMonth, Math.min(activeDay, 28)),
    horizonDays: 30,
    items: recurringItems,
    lowBalanceThreshold: 500,
  });
  const recurringWeeks = groupRecurringByWeek(recurringItems, monthDate(activeMonth, 1), 31);
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
  const spendingAnomalies = detectSpendingAnomalies({
    currentTransactions: filteredTxns
      .filter((t) => monthKey(t.date) === activeMonth && isSpending(t))
      .map((t) => ({
        id: `${t.date}-${t.account_id}-${t.name ?? t.merchant_name ?? "txn"}-${t.amount}`,
        date: t.date,
        merchant: t.merchant_name ?? t.name ?? "Unknown",
        category: t.pfc_primary ?? "UNCATEGORIZED",
        amount: t.amount,
      })),
    priorCategoryAverages: [...priorCategoryAverages.entries()].map(([category, values]) => ({
      category,
      amount: round2(values.reduce((sum, value) => sum + value, 0) / values.length),
    })),
    largeTransactionThreshold: 500,
  });
  const netWorthSnapshot = computeNetWorthSnapshot(
    allAccounts.map((account) => ({
      name: account.name ?? "Account",
      type: account.type,
      balance: account.current_balance,
    })),
  );

  const netWorthHistory = allSnapshots.map((s) => {
    const assets = Number(s.assets ?? 0);
    const liabilities = Number(s.liabilities ?? 0);
    return {
      month: s.snapshot_month.slice(0, 7), // YYYY-MM
      assets,
      liabilities,
      netWorth: round2(assets - liabilities),
    };
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
    cashFlowForecast,
    recurringWeeks,
    spendingAnomalies,
    netWorthSnapshot,
    netWorthHistory,
  };
}
