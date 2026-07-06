import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Aggregations for the dashboard. Runs with the caller's user-scoped Supabase
 * client, so RLS guarantees only the current user's rows are visible.
 *
 * Sign convention (Plaid): positive amount = money out (spending),
 * negative = money in (income). Transfers are excluded from spend/income totals.
 */

const EXCLUDED_PFC = new Set([
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
  totalBudget: number;
  lastMonthProratedSpent: number;
  spendPerCard: { name: string; amount: number }[];
  spendPerBank: { name: string; amount: number }[];
  cashFlow: { deposits: number; withdrawals: number; net: number };
}

interface TxnLite {
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

function isSpending(t: TxnLite): boolean {
  return t.amount > 0 && !EXCLUDED_PFC.has(t.pfc_primary ?? "");
}

function isIncome(t: TxnLite): boolean {
  return t.amount < 0 && !EXCLUDED_PFC.has(t.pfc_primary ?? "");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getDashboardData(
  supabase: SupabaseClient,
  selectedAccountId?: string,
  selectedMonth?: string,
): Promise<DashboardData> {
  const now = new Date();
  const currentMonth = monthKey(now.toISOString().slice(0, 10));

  const [
    { data: accounts },
    { data: txns },
    { data: streams },
    { data: items },
    { data: budgets },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select(
        "id, name, official_name, mask, type, subtype, current_balance, available_balance, credit_limit, iso_currency_code, plaid_item_id",
      )
      .order("name"),
    supabase
      .from("transactions")
      .select("date, amount, merchant_name, name, pfc_primary, account_id"),
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
  ]);

  const allAccounts = (accounts ?? []) as AccountSummary[];
  const allTxnsRaw = (txns ?? []) as TxnLite[];
  const allItems = (items ?? []) as Array<{ id: string; institution_name: string | null }>;
  const allBudgets = (budgets ?? []) as Array<{ category: string; monthly_limit: number }>;

  // Filter transactions by selected account if specified
  const filteredTxns = selectedAccountId
    ? allTxnsRaw.filter((t) => t.account_id === selectedAccountId)
    : allTxnsRaw;

  // Extract all available months from all transactions
  const monthSet = new Set<string>();
  monthSet.add(currentMonth);
  for (const t of allTxnsRaw) {
    monthSet.add(monthKey(t.date));
  }
  const availableMonths = [...monthSet].sort((a, b) => b.localeCompare(a));

  // Determine active month
  const activeMonth = selectedMonth && monthSet.has(selectedMonth)
    ? selectedMonth
    : currentMonth;

  // Monthly spending (last 6 months relative to activeMonth)
  const monthMap = new Map<string, number>();
  for (const t of filteredTxns) {
    if (!isSpending(t)) continue;
    const key = monthKey(t.date);
    monthMap.set(key, (monthMap.get(key) ?? 0) + t.amount);
  }

  // Generate last 6 months relative to activeMonth to render in the spending chart
  const activeYear = Number(activeMonth.split("-")[0]);
  const activeMonthIndex = Number(activeMonth.split("-")[1]) - 1;
  const monthlySpending: { month: string; amount: number }[] = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(activeYear, activeMonthIndex - i, 15);
    const key = monthKey(d.toISOString().slice(0, 10));
    monthlySpending.push({
      month: key,
      amount: round2(monthMap.get(key) ?? 0),
    });
  }

  // Active-month breakdowns and income/expense totals
  const categoryMap = new Map<string, number>();
  const merchantMap = new Map<string, number>();
  let currentMonthExpenses = 0;
  let currentMonthIncome = 0;

  for (const t of filteredTxns) {
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

  return {
    accounts: allAccounts,
    creditAccounts: allAccounts.filter((a) => a.type === "credit"),
    monthlySpending,
    categoryBreakdown,
    merchantBreakdown,
    currentMonthExpenses: round2(currentMonthExpenses),
    currentMonthIncome: round2(currentMonthIncome),
    subscriptions,
    incomeStreams,
    availableMonths,
    selectedMonth: activeMonth,
    totalBudget: round2(totalBudget),
    lastMonthProratedSpent: round2(lastMonthProratedSpent),
    spendPerCard,
    spendPerBank,
    cashFlow,
  };
}
