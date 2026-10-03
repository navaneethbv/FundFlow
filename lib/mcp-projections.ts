import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

export interface McpAggregateRow {
  month: string;
  category: string;
  totalAmount: number;
  outflowTotal: number;
  inflowTotal: number;
  transactionCount: number;
}

export interface McpRecurringInput {
  amount: number | string | null;
  frequency: string | null;
  category: string | null;
  itemType: string | null;
  enabled?: boolean;
  isActive?: boolean;
  streamType?: string | null;
}

export interface McpRecurringRow {
  category: string;
  frequency: string;
  kind: "income" | "expense";
  amount: number;
  count: number;
}

export interface McpNetWorthInput {
  snapshot_month: string;
  assets: number | string | null;
  liabilities: number | string | null;
}

export interface McpNetWorthRow {
  month: string;
  assets: number;
  liabilities: number;
  netWorth: number;
}

export const MCP_MIN_GROUP_SIZE = 3;

function numberValue(value: number | string | null): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function categoryFor(row: CanonicalFinanceTransaction): string {
  return row.categoryKey.trim() || "UNCATEGORIZED";
}

function monthFor(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

/** Build the aggregate-only month/category contract without exposing row ids or merchants. */
export function buildMcpAggregateRows(
  transactions: ReadonlyArray<CanonicalFinanceTransaction>,
  categoryFilter?: string | null,
): McpAggregateRow[] {
  const wanted = categoryFilter?.trim().toUpperCase() || null;
  const buckets = new Map<string, McpAggregateRow>();
  for (const row of transactions) {
    if (row.flow === "transfer") continue;
    const category = categoryFor(row);
    if (wanted && category.toUpperCase() !== wanted) continue;
    const month = monthFor(row.date);
    const key = `${month}\u0000${category}`;
    const current = buckets.get(key) ?? {
      month,
      category,
      totalAmount: 0,
      outflowTotal: 0,
      inflowTotal: 0,
      transactionCount: 0,
    };
    current.totalAmount += row.signedAmount;
    if (row.flow === "expense" && row.signedAmount > 0) current.outflowTotal += row.signedAmount;
    if (row.flow === "income") current.inflowTotal += Math.abs(row.signedAmount);
    current.transactionCount += 1;
    buckets.set(key, current);
  }
  return [...buckets.values()]
    .filter((row) => row.transactionCount >= MCP_MIN_GROUP_SIZE)
    .map((row) => ({
      ...row,
      totalAmount: round2(row.totalAmount),
      outflowTotal: round2(row.outflowTotal),
      inflowTotal: round2(row.inflowTotal),
    }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category));
}

/** Collapse recurring rows to category/frequency/kind totals without merchant identities. */
export function buildMcpRecurringRows(rows: ReadonlyArray<McpRecurringInput>): McpRecurringRow[] {
  const buckets = new Map<string, McpRecurringRow>();
  for (const row of rows) {
    if (row.enabled === false || row.isActive === false) continue;
    const frequency = row.frequency?.trim().toLowerCase() || "unknown";
    const category = row.category?.trim() || "UNCATEGORIZED";
    const kind: "income" | "expense" =
      (row.itemType ?? row.streamType ?? "expense").toLowerCase() === "income" ||
      (row.itemType ?? row.streamType ?? "expense").toLowerCase() === "inflow"
        ? "income"
        : "expense";
    const key = `${category}\u0000${frequency}\u0000${kind}`;
    const current = buckets.get(key) ?? { category, frequency, kind, amount: 0, count: 0 };
    current.amount += Math.abs(numberValue(row.amount));
    current.count += 1;
    buckets.set(key, current);
  }
  return [...buckets.values()]
    .map((row) => ({ ...row, amount: round2(row.amount) }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.frequency.localeCompare(b.frequency) || a.kind.localeCompare(b.kind));
}

export function buildMcpNetWorthTrend(rows: ReadonlyArray<McpNetWorthInput>): McpNetWorthRow[] {
  return rows
    .map((row) => {
      const assets = round2(numberValue(row.assets));
      const liabilities = round2(numberValue(row.liabilities));
      return { month: row.snapshot_month, assets, liabilities, netWorth: round2(assets - liabilities) };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
}
