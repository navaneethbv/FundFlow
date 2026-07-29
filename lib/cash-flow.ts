import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
import { UNKNOWN_CURRENCY } from "@/lib/format";

export type CashFlowPeriod = "monthly" | "quarterly" | "yearly";
export type BreakdownDimension = "category" | "group" | "merchant";
export type BreakdownDirection = "income" | "expense";

export interface PeriodCashFlow {
  key: string;
  label: string;
  income: number;
  expenses: number;
  savings: number;
  /**
   * Percent of income kept, or null when there was no income to divide by.
   * Reporting 0% for a period with expenses and no income would read as
   * "broke even" when the truth is "spent with nothing coming in".
   */
  savingsRate: number | null;
}

export interface BreakdownRow {
  label: string;
  amount: number;
  pct: number;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function periodLabel(key: string, period: CashFlowPeriod): string {
  if (period === "yearly") return key;
  if (period === "quarterly") {
    const [year, quarter] = key.split("-");
    return `${quarter} ${year}`;
  }
  const [year, month] = key.split("-");
  return `${MONTH_LABELS[Number(month) - 1] ?? month} ${year}`;
}

export function cashFlowPeriodKey(
  date: string,
  period: CashFlowPeriod,
): string {
  const year = date.slice(0, 4);
  if (period === "yearly") return year;
  const month = Number(date.slice(5, 7));
  if (period === "quarterly") {
    return `${year}-Q${Math.ceil(month / 3)}`;
  }
  return date.slice(0, 7);
}

export function computePeriodCashFlow(
  txns: CanonicalFinanceTransaction[],
  period: CashFlowPeriod,
): PeriodCashFlow[] {
  const totals = new Map<string, { income: number; expenses: number }>();
  for (const row of txns) {
    if (row.flow === "transfer") continue;
    const key = cashFlowPeriodKey(row.date, period);
    const current = totals.get(key) ?? { income: 0, expenses: 0 };
    if (row.flow === "income") current.income += Math.abs(row.signedAmount);
    if (row.flow === "expense") current.expenses += Math.abs(row.signedAmount);
    totals.set(key, current);
  }

  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, amounts]) => {
      const income = round2(amounts.income);
      const expenses = round2(amounts.expenses);
      const savings = round2(income - expenses);
      return {
        key,
        label: periodLabel(key, period),
        income,
        expenses,
        savings,
        savingsRate:
          income === 0 ? null : round2((savings / income) * 100),
      };
    });
}

const BREAKDOWN_FIELD: Record<
  BreakdownDimension,
  (row: CanonicalFinanceTransaction) => string
> = {
  category: (row) => row.categoryKey,
  group: (row) => row.groupKey,
  merchant: (row) => row.merchant,
};

function breakdownLabel(
  row: CanonicalFinanceTransaction,
  dimension: BreakdownDimension,
): string {
  return BREAKDOWN_FIELD[dimension](row).trim() || "Unknown";
}

export function breakdownBy(
  txns: CanonicalFinanceTransaction[],
  dimension: BreakdownDimension,
  direction: BreakdownDirection,
): BreakdownRow[] {
  const amounts = new Map<string, number>();
  for (const row of txns) {
    if (row.flow !== direction) continue;
    const label = breakdownLabel(row, dimension);
    amounts.set(
      label,
      (amounts.get(label) ?? 0) + Math.abs(row.signedAmount),
    );
  }

  const ranked = [...amounts]
    .map(([label, amount]) => ({ label, amount: round2(amount) }))
    .filter((row) => row.amount > 0)
    .sort(
      (a, b) =>
        b.amount - a.amount || a.label.localeCompare(b.label),
    );
  const total = ranked.reduce((sum, row) => sum + row.amount, 0);
  if (total <= 0) return [];

  let allocated = 0;
  return ranked.map((row, index) => {
    const pct =
      index === ranked.length - 1
        ? round2(100 - allocated)
        : round2((row.amount / total) * 100);
    allocated = round2(allocated + pct);
    return { ...row, pct };
  });
}

export function filterCashFlowPeriod(
  txns: CanonicalFinanceTransaction[],
  period: CashFlowPeriod,
  key: string,
): CanonicalFinanceTransaction[] {
  return txns.filter((row) => cashFlowPeriodKey(row.date, period) === key);
}

function currencyFor(
  row: CanonicalFinanceTransaction,
  currencyByAccountId: ReadonlyMap<string, string>,
): string {
  if (!row.accountId || !currencyByAccountId.has(row.accountId)) {
    return UNKNOWN_CURRENCY;
  }
  const value = currencyByAccountId.get(row.accountId)?.trim().toUpperCase();
  // An account with a blank or malformed code is treated as USD, matching
  // `app/accounts/page.tsx`. Splitting it into its own bucket here would raise
  // a "multiple currencies" warning that the Accounts page never shows.
  return value && /^[A-Z]{3}$/.test(value) ? value : "USD";
}

export function partitionCashFlowByCurrency(
  txns: CanonicalFinanceTransaction[],
  currencyByAccountId: ReadonlyMap<string, string>,
): Map<string, CanonicalFinanceTransaction[]> {
  const groups = new Map<string, CanonicalFinanceTransaction[]>();
  for (const row of txns) {
    const currency = currencyFor(row, currencyByAccountId);
    const current = groups.get(currency) ?? [];
    current.push(row);
    groups.set(currency, current);
  }
  return new Map(
    [...groups].sort(([a], [b]) => a.localeCompare(b)),
  );
}
