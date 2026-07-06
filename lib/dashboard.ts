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
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  credit_limit: number | null;
  iso_currency_code: string | null;
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
}

interface TxnLite {
  date: string;
  amount: number;
  merchant_name: string | null;
  name: string | null;
  pfc_primary: string | null;
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
): Promise<DashboardData> {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const fromDate = sixMonthsAgo.toISOString().slice(0, 10);
  const currentMonth = monthKey(now.toISOString().slice(0, 10));

  const [{ data: accounts }, { data: txns }, { data: streams }] =
    await Promise.all([
      supabase
        .from("accounts")
        .select(
          "id, name, mask, type, subtype, current_balance, available_balance, credit_limit, iso_currency_code",
        )
        .order("name"),
      supabase
        .from("transactions")
        .select("date, amount, merchant_name, name, pfc_primary")
        .gte("date", fromDate),
      supabase
        .from("recurring_streams")
        .select("merchant_name, description, average_amount, frequency, category, stream_type, is_active")
        .eq("is_active", true),
    ]);

  const allAccounts = (accounts ?? []) as AccountSummary[];
  const allTxns = (txns ?? []) as TxnLite[];

  // Monthly spending (last 6 months).
  const monthMap = new Map<string, number>();
  for (const t of allTxns) {
    if (!isSpending(t)) continue;
    const key = monthKey(t.date);
    monthMap.set(key, (monthMap.get(key) ?? 0) + t.amount);
  }
  const monthlySpending = [...monthMap.entries()]
    .map(([month, amount]) => ({ month, amount: round2(amount) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Current-month category + merchant breakdowns and income/expense totals.
  const categoryMap = new Map<string, number>();
  const merchantMap = new Map<string, number>();
  let currentMonthExpenses = 0;
  let currentMonthIncome = 0;

  for (const t of allTxns) {
    if (monthKey(t.date) !== currentMonth) continue;
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

  const streamRows = (streams ?? []) as Array<{
    merchant_name: string | null;
    description: string | null;
    average_amount: number | null;
    frequency: string | null;
    category: string | null;
    stream_type: string;
  }>;

  const subscriptions = streamRows
    .filter((s) => s.stream_type === "outflow")
    .map((s) => ({
      merchant: s.merchant_name ?? s.description ?? "Unknown",
      amount: round2(Math.abs(s.average_amount ?? 0)),
      frequency: s.frequency,
      category: s.category,
    }))
    .sort((a, b) => b.amount - a.amount);

  const incomeStreams = streamRows
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
  };
}
