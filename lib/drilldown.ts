import { titleCase } from "@/lib/format";

/**
 * Pure drill-down helpers for the dashboard. Everything here operates on
 * already-fetched, rules-applied window transactions (no I/O), mirroring the
 * chart-utils.ts pattern so it stays unit-testable.
 *
 * Sign convention (Plaid): positive amount = money out. Callers pass
 * spending-only, refund-excluded transactions (lib/dashboard.ts owns those
 * filters via isSpending + the linked-refund set).
 */

export const MANUAL_SPLIT_KEY = "MANUAL_SPLIT";
export const OTHER_CATEGORY_KEY = "_other";
const UNCATEGORIZED_KEY = "UNCATEGORIZED";

export interface DrillTxn {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  merchant: string;
  category: string | null; // rules-applied pfc_primary
  subcategory: string | null; // pfc_detailed
}

export interface DrillSplit {
  transactionId: string;
  category: string;
  amount: number;
}

export interface DrillParams {
  category?: string;
  sub?: string;
  merchant?: string;
}

export interface KnownDrillValues {
  categories: Set<string>;
  subcategories: Set<string>;
  /** lower-cased, trimmed merchant names */
  merchants: Set<string>;
}

/**
 * Validate raw searchParam strings against values that actually exist in the
 * user's data. Anything unknown is dropped (the page renders un-drilled).
 * category wins over merchant; sub requires a valid category.
 */
export function normalizeDrillParams(
  raw: DrillParams,
  known: KnownDrillValues,
): DrillParams {
  if (raw.category === OTHER_CATEGORY_KEY) return { category: OTHER_CATEGORY_KEY };
  if (raw.category && (known.categories.has(raw.category) || raw.category === UNCATEGORIZED_KEY)) {
    const out: DrillParams = { category: raw.category };
    if (
      raw.sub &&
      (known.subcategories.has(raw.sub) ||
        raw.sub === MANUAL_SPLIT_KEY ||
        raw.sub === UNCATEGORIZED_KEY)
    ) {
      out.sub = raw.sub;
    }
    return out;
  }
  if (raw.merchant) {
    const merchant = raw.merchant.trim();
    if (known.merchants.has(merchant.toLowerCase())) return { merchant };
  }
  return {};
}

/** Canonical /dashboard URL builder; skips empty params, stable key order. */
export function dashboardUrl(params: {
  tab?: string;
  month?: string;
  accountId?: string;
  itemId?: string;
  category?: string;
  sub?: string;
  merchant?: string;
}): string {
  const search = new URLSearchParams();
  for (const key of ["tab", "month", "accountId", "itemId", "category", "sub", "merchant"] as const) {
    const value = params[key];
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}

/** "RENT_AND_UTILITIES_RENT" within RENT_AND_UTILITIES -> "Rent". */
export function subcategoryLabel(category: string, subKey: string): string {
  if (subKey === MANUAL_SPLIT_KEY) return "Manual split";
  if (subKey === UNCATEGORIZED_KEY) return "Uncategorized";
  const prefix = `${category}_`;
  return titleCase(subKey.startsWith(prefix) ? subKey.slice(prefix.length) : subKey);
}

export interface CategoryDrilldownData {
  kind: "category";
  category: string;
  sub: string | null;
  /** Active-month total for the drilled scope. */
  total: number;
  /** Active-month total minus previous month's. */
  momDelta: number;
  subcategories: { key: string; label: string; amount: number }[];
  merchants: { merchant: string; amount: number }[];
  trend: { month: string; amount: number }[];
  /** Active-month rows, newest first, capped; amount = attributed amount. */
  transactions: DrillTxn[];
}

const TXN_CAP = 25;
const MERCHANT_CAP = 8;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface Contribution {
  txn: DrillTxn;
  amount: number;
  subKey: string;
}

export function buildCategoryDrilldown(input: {
  txns: DrillTxn[];
  splits: DrillSplit[];
  category: string;
  sub: string | null;
  /** Window months oldest -> newest; must contain activeMonth. */
  months: string[];
  activeMonth: string;
}): CategoryDrilldownData {
  const { txns, splits, category, sub, months, activeMonth } = input;

  const splitsByTxn = new Map<string, DrillSplit[]>();
  for (const split of splits) {
    const rows = splitsByTxn.get(split.transactionId) ?? [];
    rows.push(split);
    splitsByTxn.set(split.transactionId, rows);
  }

  // Membership: split-aware for the active month (splits are only fetched for
  // it), whole-transaction category elsewhere - matching how the donut totals
  // are computed so drill totals always reconcile.
  const contributions: Contribution[] = [];
  for (const txn of txns) {
    const month = txn.date.slice(0, 7);
    if (month === activeMonth) {
      const rows = splitsByTxn.get(txn.id);
      const splitTotal = rows?.reduce((sum, row) => sum + row.amount, 0) ?? 0;
      if (rows && Math.abs(Math.abs(txn.amount) - splitTotal) < 0.01) {
        for (const row of rows) {
          if (row.category !== category) continue;
          contributions.push({ txn, amount: row.amount, subKey: MANUAL_SPLIT_KEY });
        }
        continue;
      }
    }
    if ((txn.category ?? "UNCATEGORIZED") !== category) continue;
    contributions.push({
      txn,
      amount: txn.amount,
      subKey: txn.subcategory ?? "UNCATEGORIZED",
    });
  }

  const scoped = sub ? contributions.filter((c) => c.subKey === sub) : contributions;

  const trendMap = new Map<string, number>();
  for (const c of scoped) {
    const month = c.txn.date.slice(0, 7);
    trendMap.set(month, (trendMap.get(month) ?? 0) + c.amount);
  }
  const trend = months.map((month) => ({ month, amount: round2(trendMap.get(month) ?? 0) }));

  const activeScoped = scoped.filter((c) => c.txn.date.slice(0, 7) === activeMonth);
  const total = round2(activeScoped.reduce((sum, c) => sum + c.amount, 0));
  const activeIndex = months.indexOf(activeMonth);
  const prevAmount = activeIndex > 0 ? (trend[activeIndex - 1]?.amount ?? 0) : 0;
  const momDelta = round2(total - prevAmount);

  const subMap = new Map<string, number>();
  const merchantMap = new Map<string, number>();
  for (const c of activeScoped) {
    subMap.set(c.subKey, (subMap.get(c.subKey) ?? 0) + c.amount);
    merchantMap.set(c.txn.merchant, (merchantMap.get(c.txn.merchant) ?? 0) + c.amount);
  }
  const subcategories = [...subMap.entries()]
    .map(([key, amount]) => ({ key, label: subcategoryLabel(category, key), amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  const merchants = [...merchantMap.entries()]
    .map(([merchant, amount]) => ({ merchant, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount || a.merchant.localeCompare(b.merchant))
    .slice(0, MERCHANT_CAP);

  // One row per transaction (a multi-split txn contributes once, with the
  // summed attributed amount), newest first.
  const byId = new Map<string, DrillTxn>();
  for (const c of activeScoped) {
    const existing = byId.get(c.txn.id);
    byId.set(
      c.txn.id,
      existing
      ? { ...existing, amount: round2(existing.amount + c.amount) }
      : { ...c.txn, amount: round2(c.amount) },
    );
  }
  const transactions = [...byId.values()]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)))
    .slice(0, TXN_CAP);

  return { kind: "category", category, sub, total, momDelta, subcategories, merchants, trend, transactions };
}
