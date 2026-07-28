import { EXCLUDED_PFC } from "@/lib/dashboard";

/**
 * Year in Money (8.1): pure annual-recap aggregation for /wrapped.
 * Amount sign follows Plaid: positive = money out. Transfers and loan
 * payments are cash movement, not spending or income, so they are dropped
 * from every figure (same EXCLUDED_PFC rule as every spend total in the app).
 */

export interface AnnualTxn {
  date: string; // YYYY-MM-DD
  amount: number;
  merchant: string;
  category: string | null;
}

export interface YearInMoney {
  year: string;
  totalSpend: number;
  totalIncome: number;
  /** Whole-percent savings rate, floored at 0. */
  savingsRate: number;
  topMerchants: { merchant: string; amount: number }[];
  topCategories: { category: string; amount: number }[];
  /** Null when the year had income but no spending. */
  biggestMonth: { month: string; spend: number } | null;
  /** Lowest non-zero spend month; null without one. */
  quietestMonth: { month: string; spend: number } | null;
  largestPurchase: { merchant: string; amount: number; date: string } | null;
  /** Jan..Dec spend, zeros for quiet months. */
  monthlySpendSeries: number[];
  /** Rows that counted (transfers/loan payments excluded). */
  transactionCount: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeYearInMoney(
  txns: AnnualTxn[],
  year: string,
): YearInMoney | null {
  const rows = txns.filter(
    (t) => t.date.startsWith(`${year}-`) && !EXCLUDED_PFC.has(t.category ?? ""),
  );
  if (rows.length === 0) return null;

  let totalSpend = 0;
  let totalIncome = 0;
  const byMerchant = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const monthlySpendSeries = new Array<number>(12).fill(0);
  let largestPurchase: YearInMoney["largestPurchase"] = null;

  for (const t of rows) {
    if (t.amount > 0) {
      totalSpend += t.amount;
      byMerchant.set(t.merchant, (byMerchant.get(t.merchant) ?? 0) + t.amount);
      const category = t.category ?? "UNCATEGORIZED";
      byCategory.set(category, (byCategory.get(category) ?? 0) + t.amount);
      const monthIndex = Number(t.date.slice(5, 7)) - 1;
      if (monthIndex >= 0 && monthIndex < 12) {
        monthlySpendSeries[monthIndex]! += t.amount;
      }
      if (!largestPurchase || t.amount > largestPurchase.amount) {
        largestPurchase = { merchant: t.merchant, amount: round2(t.amount), date: t.date };
      }
    } else if (t.amount < 0) {
      totalIncome += Math.abs(t.amount);
    }
  }

  for (let i = 0; i < 12; i++) monthlySpendSeries[i] = round2(monthlySpendSeries[i]!);

  const monthKey = (index: number) => `${year}-${String(index + 1).padStart(2, "0")}`;
  let biggestMonth: YearInMoney["biggestMonth"] = null;
  let quietestMonth: YearInMoney["quietestMonth"] = null;
  monthlySpendSeries.forEach((spend, index) => {
    if (spend <= 0) return;
    if (!biggestMonth || spend > biggestMonth.spend) {
      biggestMonth = { month: monthKey(index), spend };
    }
    if (!quietestMonth || spend < quietestMonth.spend) {
      quietestMonth = { month: monthKey(index), spend };
    }
  });

  const top = <K extends string>(map: Map<string, number>, key: K) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount]) => ({ [key]: name, amount: round2(amount) })) as Array<
      Record<K, string> & { amount: number }
    >;

  totalSpend = round2(totalSpend);
  totalIncome = round2(totalIncome);

  return {
    year,
    totalSpend,
    totalIncome,
    savingsRate:
      totalIncome <= 0
        ? 0
        : Math.max(0, Math.round(((totalIncome - totalSpend) / totalIncome) * 100)),
    topMerchants: top(byMerchant, "merchant"),
    topCategories: top(byCategory, "category"),
    biggestMonth,
    quietestMonth,
    largestPurchase,
    monthlySpendSeries,
    transactionCount: rows.length,
  };
}
