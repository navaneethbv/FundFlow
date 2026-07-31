import { financeTotals, type CanonicalFinanceTransaction } from "@/lib/finance-domain";
import type { BreakdownDimension } from "@/lib/cash-flow";
import type { SankeyLink, SankeyNode } from "@/lib/sankey";

/**
 * Report aggregation over the canonical Phase 0 projection. Pure: no Supabase,
 * no dates from the clock, so every figure here is reproducible from its input.
 *
 * Totals come from `financeTotals` rather than being re-summed locally, which
 * is what keeps the Reports summary panel and the Cash Flow page from
 * disagreeing about the same range.
 */

/** The label a blank or uncategorized key is shown as, matching Cash Flow. */
const UNKNOWN_LABEL = "Unknown";

const HUB_ID = "hub";
const UNFUNDED_ID = "src:__unfunded__";
const NET_INCOME_ID = "grp:__net__";

/** The four columns: sources → hub → groups → categories. */
const SOURCE_COLUMN = 0;
const HUB_COLUMN = 1;
const GROUP_COLUMN = 2;
const CATEGORY_COLUMN = 3;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Blank keys and the projection's `UNCATEGORIZED` sentinel both mean "we do
 * not know", so they fold into one bucket rather than reading as two
 * different categories.
 */
function label(key: string): string {
  const trimmed = key.trim();
  if (!trimmed || trimmed.toUpperCase() === "UNCATEGORIZED") return UNKNOWN_LABEL;
  return trimmed;
}

function addTo(totals: Map<string, number>, key: string, amount: number): void {
  totals.set(key, (totals.get(key) ?? 0) + amount);
}

/** Value descending, label ascending — deterministic for a given input. */
function ranked(totals: Map<string, number>): Array<[string, number]> {
  return [...totals]
    .filter(([, amount]) => amount > 0)
    .sort(([labelA, a], [labelB, b]) => b - a || labelA.localeCompare(labelB));
}

/**
 * Cash-flow Sankey: income categories → hub → expense groups → categories.
 *
 * With a surplus the hub is "Income" and a terminal "Net Income" node absorbs
 * what was not spent. With a deficit the hub is "Available Funds" and an
 * "Unfunded Spending" source supplies the shortfall, so the diagram still
 * balances instead of drawing a negative ribbon. Transfers (including both
 * halves of a linked refund, and every credit-card payment) are excluded by
 * `flow`, so no cash movement is ever counted as spending or income.
 */
export function buildCashFlowSankeyData(
  txns: CanonicalFinanceTransaction[],
): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const incomeByCategory = new Map<string, number>();
  const expenseByGroup = new Map<string, number>();
  const expenseByGroupCategory = new Map<string, Map<string, number>>();

  for (const row of txns) {
    const amount = Math.abs(row.signedAmount);
    if (amount <= 0) continue;

    if (row.flow === "income") {
      addTo(incomeByCategory, label(row.categoryKey), amount);
      continue;
    }
    if (row.flow !== "expense") continue;

    const groupLabel = label(row.groupKey);
    addTo(expenseByGroup, groupLabel, amount);
    const categories =
      expenseByGroupCategory.get(groupLabel) ?? new Map<string, number>();
    addTo(categories, label(row.categoryKey), amount);
    expenseByGroupCategory.set(groupLabel, categories);
  }

  const incomeRows = ranked(incomeByCategory);
  const groupRows = ranked(expenseByGroup);
  const totalIncome = round2(
    incomeRows.reduce((sum, [, amount]) => sum + amount, 0),
  );
  const totalExpenses = round2(
    groupRows.reduce((sum, [, amount]) => sum + amount, 0),
  );
  if (totalIncome <= 0 && totalExpenses <= 0) return { nodes: [], links: [] };

  const net = round2(totalIncome - totalExpenses);
  const shortfall = net < 0 ? Math.abs(net) : 0;
  const surplus = net > 0 ? net : 0;
  const hubValue = round2(totalIncome + shortfall);

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  // Column 0 — income sources, with the shortfall last so it reads as the
  // remainder that had to come from somewhere else.
  for (const [name, amount] of incomeRows) {
    nodes.push({
      id: `src:${name}`,
      label: name,
      value: round2(amount),
      column: SOURCE_COLUMN,
    });
  }
  if (shortfall > 0) {
    nodes.push({
      id: UNFUNDED_ID,
      label: "Unfunded Spending",
      value: shortfall,
      column: SOURCE_COLUMN,
    });
  }

  nodes.push({
    id: HUB_ID,
    label: shortfall > 0 ? "Available Funds" : "Income",
    value: hubValue,
    column: HUB_COLUMN,
  });

  // Column 2 — expense groups, then the surplus as a terminal node.
  for (const [name, amount] of groupRows) {
    nodes.push({
      id: `grp:${name}`,
      label: name,
      value: round2(amount),
      column: GROUP_COLUMN,
    });
  }
  if (surplus > 0) {
    nodes.push({
      id: NET_INCOME_ID,
      label: "Net Income",
      value: surplus,
      column: GROUP_COLUMN,
    });
  }

  // Column 3 — categories, emitted in their parent group's order so ribbons
  // stack without crossing (layoutSankey stacks a column in array order).
  for (const [groupName] of groupRows) {
    const categories = expenseByGroupCategory.get(groupName);
    if (!categories) continue;
    for (const [categoryName, amount] of ranked(categories)) {
      nodes.push({
        id: `cat:${groupName}::${categoryName}`,
        label: categoryName,
        value: round2(amount),
        column: CATEGORY_COLUMN,
      });
    }
  }

  // Links follow the same order as the nodes above, for the same reason.
  for (const [name, amount] of incomeRows) {
    links.push({ source: `src:${name}`, target: HUB_ID, value: round2(amount) });
  }
  if (shortfall > 0) {
    links.push({ source: UNFUNDED_ID, target: HUB_ID, value: shortfall });
  }
  for (const [name, amount] of groupRows) {
    links.push({ source: HUB_ID, target: `grp:${name}`, value: round2(amount) });
  }
  if (surplus > 0) {
    links.push({ source: HUB_ID, target: NET_INCOME_ID, value: surplus });
  }
  for (const [groupName] of groupRows) {
    const categories = expenseByGroupCategory.get(groupName);
    if (!categories) continue;
    for (const [categoryName, amount] of ranked(categories)) {
      links.push({
        source: `grp:${groupName}`,
        target: `cat:${groupName}::${categoryName}`,
        value: round2(amount),
      });
    }
  }

  return { nodes, links };
}

export interface ReportSummary {
  totalTransactions: number;
  /** The signed amount of the row with the largest absolute magnitude. */
  largest: number;
  averageAbsolute: number;
  totalIncome: number;
  totalSpending: number;
  firstDate: string | null;
  lastDate: string | null;
}

/**
 * Counts, extremes, and the date span describe the row set the user is looking
 * at, so they include every filtered row — transfers too, since those appear in
 * the transaction table below the chart. Income and spending come from
 * `financeTotals`, which excludes transfers, so those two figures still mean
 * what they mean everywhere else in the app.
 */
export function summarizeTransactions(
  txns: CanonicalFinanceTransaction[],
): ReportSummary {
  if (txns.length === 0) {
    return {
      totalTransactions: 0,
      largest: 0,
      averageAbsolute: 0,
      totalIncome: 0,
      totalSpending: 0,
      firstDate: null,
      lastDate: null,
    };
  }

  let largest = 0;
  let absoluteSum = 0;
  let firstDate = txns[0]!.date;
  let lastDate = txns[0]!.date;

  for (const row of txns) {
    const magnitude = Math.abs(row.signedAmount);
    absoluteSum += magnitude;
    if (magnitude > Math.abs(largest)) largest = row.signedAmount;
    if (row.date < firstDate) firstDate = row.date;
    if (row.date > lastDate) lastDate = row.date;
  }

  const totals = financeTotals(txns);
  return {
    totalTransactions: txns.length,
    largest: round2(largest),
    averageAbsolute: round2(absoluteSum / txns.length),
    totalIncome: totals.income,
    totalSpending: totals.expenses,
    firstDate,
    lastDate,
  };
}

/**
 * Saved-report filter schema. The version is checked strictly on read: a
 * payload from a future schema is rejected rather than partially understood,
 * because silently dropping a filter would show the user a different row set
 * than the one they saved under that name.
 */
export const REPORT_FILTERS_VERSION = 1 as const;

export type ReportTab = "cash_flow" | "spending" | "income";
export type ReportMode = "breakdown" | "trends";

export interface ReportFilters {
  version: typeof REPORT_FILTERS_VERSION;
  /** Inclusive `YYYY-MM-DD`. */
  start: string;
  /** Inclusive `YYYY-MM-DD`. */
  end: string;
  tab: ReportTab;
  mode: ReportMode;
  dimension: BreakdownDimension;
  /** Household id, or null for the caller's own rows. */
  scope: string | null;
  accounts: string[];
  merchants: string[];
  categories: string[];
  excludePending: boolean;
}

export const REPORT_TABS: readonly ReportTab[] = ["cash_flow", "spending", "income"];
const REPORT_MODES: readonly ReportMode[] = ["breakdown", "trends"];
const REPORT_DIMENSIONS: readonly BreakdownDimension[] = [
  "category",
  "group",
  "merchant",
];

/** Bounds on the jsonb payload, so a saved report cannot grow without limit. */
const MAX_FILTER_ENTRIES = 500;
const MAX_FILTER_ENTRY_LENGTH = 200;
const MAX_SCOPE_LENGTH = 100;

/** A calendar-valid `YYYY-MM-DD`; the regex alone would accept 2026-13-45. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function parseStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_FILTER_ENTRIES) return null;
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > MAX_FILTER_ENTRY_LENGTH) return null;
    entries.push(trimmed);
  }
  return entries;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function parseReportFilters(input: unknown): ReportFilters | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  if (raw.version !== REPORT_FILTERS_VERSION) return null;
  if (!isIsoDate(raw.start) || !isIsoDate(raw.end)) return null;
  if (raw.start > raw.end) return null;

  const tab = oneOf(raw.tab, REPORT_TABS);
  const mode = oneOf(raw.mode, REPORT_MODES);
  const dimension = oneOf(raw.dimension, REPORT_DIMENSIONS);
  if (!tab || !mode || !dimension) return null;

  if (typeof raw.excludePending !== "boolean") return null;

  let scope: string | null = null;
  if (raw.scope !== null && raw.scope !== undefined) {
    if (typeof raw.scope !== "string") return null;
    const trimmed = raw.scope.trim();
    if (!trimmed || trimmed.length > MAX_SCOPE_LENGTH) return null;
    scope = trimmed;
  }

  const accounts = parseStringList(raw.accounts);
  const merchants = parseStringList(raw.merchants);
  const categories = parseStringList(raw.categories);
  if (!accounts || !merchants || !categories) return null;

  return {
    version: REPORT_FILTERS_VERSION,
    start: raw.start,
    end: raw.end,
    tab,
    mode,
    dimension,
    scope,
    accounts,
    merchants,
    categories,
    excludePending: raw.excludePending,
  };
}

/**
 * Apply a saved or URL-derived filter to canonical rows. Merchant, account, and
 * category matching is case-insensitive so a saved report keeps working after a
 * merchant rule renames its target.
 */
export function applyReportFilters(
  txns: CanonicalFinanceTransaction[],
  filters: ReportFilters,
): CanonicalFinanceTransaction[] {
  const lower = (values: string[]) =>
    values.length > 0 ? new Set(values.map((value) => value.toLowerCase())) : null;
  const accounts = lower(filters.accounts);
  const merchants = lower(filters.merchants);
  const categories = lower(filters.categories);

  return txns.filter((row) => {
    if (row.date < filters.start || row.date > filters.end) return false;
    if (filters.excludePending && row.pending) return false;
    if (accounts) {
      const accountId = row.accountId ?? row.manualAccountId ?? "";
      if (!accounts.has(accountId.toLowerCase())) return false;
    }
    if (merchants && !merchants.has(row.merchant.trim().toLowerCase())) {
      return false;
    }
    if (categories && !categories.has(row.categoryKey.trim().toLowerCase())) {
      return false;
    }
    return true;
  });
}

/** The URL shape the Reports page navigates with. Pure URL, no client JS. */
export function reportFiltersToSearchParams(
  filters: ReportFilters,
): URLSearchParams {
  const params = new URLSearchParams({
    start: filters.start,
    end: filters.end,
    tab: filters.tab,
    mode: filters.mode,
    dimension: filters.dimension,
    pending: filters.excludePending ? "exclude" : "include",
  });
  if (filters.scope) params.set("scope", filters.scope);
  for (const account of filters.accounts) params.append("account", account);
  for (const merchant of filters.merchants) params.append("merchant", merchant);
  for (const category of filters.categories) params.append("category", category);
  return params;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function listValue(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= MAX_FILTER_ENTRY_LENGTH)
    .slice(0, MAX_FILTER_ENTRIES);
}

export type ReportSearchParams = Record<string, string | string[] | undefined>;

/**
 * Read filters off the URL. Unlike `parseReportFilters`, this never fails: a
 * hand-edited query string falls back to the default range and tab rather than
 * 404ing a page the user can still use.
 */
export function reportFiltersFromSearchParams(
  params: ReportSearchParams,
  fallback: ReportFilters,
): ReportFilters {
  const start = firstValue(params.start);
  const end = firstValue(params.end);
  const validStart = isIsoDate(start) ? start : fallback.start;
  const validEnd = isIsoDate(end) ? end : fallback.end;

  return {
    version: REPORT_FILTERS_VERSION,
    // An inverted hand-typed range would show nothing at all; fall back.
    start: validStart <= validEnd ? validStart : fallback.start,
    end: validStart <= validEnd ? validEnd : fallback.end,
    tab: oneOf(firstValue(params.tab), REPORT_TABS) ?? fallback.tab,
    mode: oneOf(firstValue(params.mode), REPORT_MODES) ?? fallback.mode,
    dimension:
      oneOf(firstValue(params.dimension), REPORT_DIMENSIONS) ??
      fallback.dimension,
    scope: fallback.scope,
    accounts: listValue(params.account),
    merchants: listValue(params.merchant),
    categories: listValue(params.category),
    excludePending: firstValue(params.pending) === "exclude",
  };
}

/**
 * The exclusive end a bounded query needs, from the inclusive end a user picked.
 * `FinanceWindow.endExclusive` is exclusive, so passing `filters.end` straight
 * through would silently drop the last day of every report.
 */
export function endExclusiveFor(end: string): string {
  const date = new Date(`${end}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** First through last day of `month` ("YYYY-MM"), the default report range. */
export function defaultReportFilters(month: string): ReportFilters {
  const [year, monthNumber] = month.split("-").map(Number);
  // Day 0 of the next month is the last day of this one, no leap-year table.
  const lastDay = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  return {
    version: REPORT_FILTERS_VERSION,
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
    tab: "cash_flow",
    mode: "breakdown",
    dimension: "category",
    scope: null,
    accounts: [],
    merchants: [],
    categories: [],
    excludePending: false,
  };
}
