import {
  LEDGER_COLUMNS,
  parseLedgerColumns,
  type LedgerColumn,
} from "@/lib/ledger-columns";
import { firstSearchParamOrEmpty } from "@/lib/search-params";

export const LEDGER_SORT_FIELDS = [
  "date",
  "amount",
  "merchant",
  "category",
  "account",
] as const;

export type LedgerSortField = (typeof LEDGER_SORT_FIELDS)[number];
export type LedgerSortDirection = "asc" | "desc";

export type LedgerReviewFilter = "all" | "needs_review" | "reviewed";

export interface LedgerRawSearchParams {
  start?: string | string[];
  end?: string | string[];
  tag?: string | string[];
  tagState?: string | string[];
  note?: string | string[];
  cleared?: string | string[];
  source?: string | string[];
  receipt?: string | string[];
  split?: string | string[];
  month?: string | string[];
  day?: string | string[];
  year?: string | string[];
  accountId?: string | string[];
  q?: string | string[];
  page?: string | string[];
  category?: string | string[];
  sub?: string | string[];
  merchant?: string | string[];
  flow?: string | string[];
  accountType?: string | string[];
  sort?: string | string[];
  direction?: string | string[];
  col?: string | string[];
  colsSubmitted?: string | string[];
  review?: string | string[];
  view?: string | string[];
  minAmount?: string | string[];
  maxAmount?: string | string[];
  status?: string | string[];
}

export interface LedgerFilters {
  q: string;
  start?: string;
  end?: string;
  tag?: string;
  tagState?: "" | "tagged" | "untagged";
  note?: string;
  cleared?: "" | "cleared" | "uncleared";
  source?: "" | "plaid" | "import" | "manual";
  receipt?: "" | "attached" | "missing";
  split?: "" | "split" | "unsplit";
  month: string;
  day?: string;
  year?: string;
  accountId: string;
  category: string;
  sub: string;
  merchant: string;
  flow: "" | "in" | "out";
  accountType: "" | "depository" | "credit";
  review: LedgerReviewFilter;
  /** Absolute amount, in the transaction's own currency. */
  minAmount?: string;
  maxAmount?: string;
  status?: "" | "pending" | "posted";
}

export interface LedgerQueryState extends LedgerFilters {
  dateError: string;
  view: "list" | "calendar";
  sort: LedgerSortField;
  direction: LedgerSortDirection;
  page: number;
  columns: Set<LedgerColumn>;
  columnsSubmitted: boolean;
}

export type LedgerQueryEntry = readonly [string, string];
export type LedgerQueryPatch = Record<
  string,
  string | readonly string[] | null | undefined
>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORY_RE = /^[A-Z][A-Z0-9_]*$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const FILTER_KEYS = [
  "start", "end", "tag", "tagState", "note", "cleared", "source", "receipt", "split",
  "q",
  "month",
  "day",
  "year",
  "accountId",
  "category",
  "sub",
  "merchant",
  "flow",
  "accountType",
  "review",
  "minAmount",
  "maxAmount",
  "status",
] as const satisfies readonly (keyof LedgerFilters)[];

export const CLEAR_LEDGER_FILTERS: LedgerQueryPatch = Object.fromEntries(
  FILTER_KEYS.map((key) => [key, null]),
);

/** Decimal-only input also keeps values interpolated into PostgREST grammar safe. */
export function normalizeLedgerAmount(value: string): string {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return "";
  return Number(value).toFixed(2);
}

export function sanitizeLedgerSearch(value: string): string {
  return value
    .replace(/[%_,()."\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matching(pattern: RegExp, value: string): string {
  return pattern.test(value) ? value : "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function isLedgerDate(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day!);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

export function ledgerDateRangeError(start: string, end: string): string {
  if (!start && !end) return "";
  if (!isLedgerDate(start) || !isLedgerDate(end)) return "Enter a valid start and end date.";
  if (start > end) return "Start date cannot be after end date.";
  return "";
}

export function parseLedgerQuery(
  raw: LedgerRawSearchParams,
): LedgerQueryState {
  const param = (value: string | string[] | undefined) => firstSearchParamOrEmpty(value);
  return {
    q: sanitizeLedgerSearch(param(raw.q)),
    start: param(raw.start).slice(0, 64),
    end: param(raw.end).slice(0, 64),
    dateError: ledgerDateRangeError(param(raw.start), param(raw.end)),
    tag: param(raw.tag).trim().slice(0, 50),
    tagState: oneOf(param(raw.tagState), ["tagged", "untagged"] as const, ""),
    note: param(raw.note).trim().slice(0, 500),
    cleared: oneOf(param(raw.cleared), ["cleared", "uncleared"] as const, ""),
    source: oneOf(param(raw.source), ["plaid", "import", "manual"] as const, ""),
    receipt: oneOf(param(raw.receipt), ["attached", "missing"] as const, ""),
    split: oneOf(param(raw.split), ["split", "unsplit"] as const, ""),
    month: matching(MONTH_RE, param(raw.month)),
    day: isLedgerDate(param(raw.day)) ? param(raw.day) : "",
    year: matching(YEAR_RE, param(raw.year)),
    accountId: matching(UUID_RE, param(raw.accountId)),
    category: matching(CATEGORY_RE, param(raw.category)),
    sub: matching(CATEGORY_RE, param(raw.sub)),
    merchant: sanitizeLedgerSearch(param(raw.merchant)),
    flow: oneOf(param(raw.flow), ["in", "out"] as const, ""),
    accountType: oneOf(param(raw.accountType), ["depository", "credit"] as const, ""),
    review: oneOf(param(raw.review), ["needs_review", "reviewed"] as const, "all"),
    minAmount: normalizeLedgerAmount(param(raw.minAmount)),
    maxAmount: normalizeLedgerAmount(param(raw.maxAmount)),
    status: oneOf(param(raw.status), ["pending", "posted"] as const, ""),
    view: oneOf(param(raw.view), ["calendar"] as const, "list"),
    sort: oneOf(param(raw.sort), LEDGER_SORT_FIELDS, "date"),
    direction: oneOf(param(raw.direction), ["asc", "desc"] as const, "desc"),
    page: Math.max(1, Number.parseInt(param(raw.page), 10) || 1),
    columns: parseLedgerColumns({
      col: raw.col,
      colsSubmitted: raw.colsSubmitted,
    }),
    columnsSubmitted: Boolean(param(raw.colsSubmitted)),
  };
}

export function ledgerQueryEntries(
  state: LedgerQueryState,
): LedgerQueryEntry[] {
  const entries = ledgerFilterEntries(state);
  if (state.sort !== "date") entries.push(["sort", state.sort]);
  if (state.direction !== "desc") entries.push(["direction", state.direction]);
  if (state.page > 1) entries.push(["page", String(state.page)]);
  entries.push(...ledgerColumnEntries(state));
  if (state.view === "calendar") entries.push(["view", "calendar"]);
  return entries;
}

function ledgerFilterEntries(state: LedgerQueryState): LedgerQueryEntry[] {
  const entries: LedgerQueryEntry[] = [];
  for (const key of FILTER_KEYS) {
    const value = state[key];
    if (key === "review" && value === "all") continue;
    if (value) entries.push([key, value]);
  }
  return entries;
}

function ledgerColumnEntries(state: LedgerQueryState): LedgerQueryEntry[] {
  if (!state.columnsSubmitted) return [];
  return [
    ["colsSubmitted", "1"],
    ...LEDGER_COLUMNS.filter((column) => state.columns.has(column)).map((column): LedgerQueryEntry => ["col", column]),
  ];
}

export function ledgerHref(
  entries: readonly LedgerQueryEntry[],
  patch: LedgerQueryPatch,
  options: { resetPage?: boolean } = {},
): string {
  const params = new URLSearchParams(
    entries.map(([key, value]) => [key, value]),
  );
  if (options.resetPage !== false) params.delete("page");

  for (const [key, value] of Object.entries(patch)) {
    params.delete(key);
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== null && value !== undefined && value !== "") {
      params.set(key, value as string);
    }
  }

  const query = params.toString();
  return query ? `/transactions?${query}` : "/transactions";
}

export function savedLedgerViewParams(
  state: LedgerQueryState,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = state[key];
    if (key === "review") {
      if (value && value !== "all") params[key] = value;
    } else if (value) {
      params[key] = value;
    }
  }
  if (state.sort !== "date") {
    params.sort = state.sort;
    params.direction = state.direction;
  } else if (state.direction !== "desc") {
    params.direction = state.direction;
  }
  return params;
}

export function hasActiveLedgerFilters(filters: LedgerFilters): boolean {
  return FILTER_KEYS.some((key) => {
    if (key === "review") return filters.review !== "all";
    return Boolean(filters[key]);
  });
}


type LedgerDateBounds = { start: string; end: string };

function ledgerMonthRange(month: string): LedgerDateBounds {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year!, number!, 0);
  return { start: `${month}-01`, end: `${month}-${String(date.getUTCDate()).padStart(2, "0")}` };
}

function selectedLedgerDateBounds(filters: LedgerFilters): LedgerDateBounds | null {
  if (filters.day) return { start: filters.day, end: filters.day };
  if (filters.start && filters.end) return { start: filters.start, end: filters.end };
  if (filters.month) return ledgerMonthRange(filters.month);
  if (filters.year) return { start: `${filters.year}-01-01`, end: `${filters.year}-12-31` };
  return null;
}

function intersectLedgerDateBounds(left: LedgerDateBounds, right: LedgerDateBounds): LedgerDateBounds {
  return {
    start: left.start > right.start ? left.start : right.start,
    end: left.end < right.end ? left.end : right.end,
  };
}

/** Custom ranges override month/year and constrain day drilldowns; calendar adds its visible-month intersection. */
export function resolveLedgerDateBounds(filters: LedgerFilters, calendarMonth?: string): LedgerDateBounds | null {
  let bounds = selectedLedgerDateBounds(filters);
  if (filters.day && filters.start && filters.end) {
    bounds = intersectLedgerDateBounds({ start: filters.day, end: filters.day }, { start: filters.start, end: filters.end });
  }
  if (!calendarMonth) return bounds;
  const calendar = ledgerMonthRange(calendarMonth);
  return bounds ? intersectLedgerDateBounds(bounds, calendar) : calendar;
}
