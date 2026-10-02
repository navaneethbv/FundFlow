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
}

export interface LedgerFilters {
  q: string;
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
}

export interface LedgerQueryState extends LedgerFilters {
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
] as const satisfies readonly (keyof LedgerFilters)[];

export function sanitizeLedgerSearch(value: string): string {
  return value
    .replace(/[%_,()."\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseLedgerQuery(
  raw: LedgerRawSearchParams,
): LedgerQueryState {
  const sortValue = firstSearchParamOrEmpty(raw.sort);
  const directionValue = firstSearchParamOrEmpty(raw.direction);
  const monthValue = firstSearchParamOrEmpty(raw.month);
  const dayValue = firstSearchParamOrEmpty(raw.day);
  const yearValue = firstSearchParamOrEmpty(raw.year);
  const accountValue = firstSearchParamOrEmpty(raw.accountId);
  const categoryValue = firstSearchParamOrEmpty(raw.category);
  const subValue = firstSearchParamOrEmpty(raw.sub);
  const flowValue = firstSearchParamOrEmpty(raw.flow);
  const accountTypeValue = firstSearchParamOrEmpty(raw.accountType);
  const reviewValue = firstSearchParamOrEmpty(raw.review);
  const viewValue = firstSearchParamOrEmpty(raw.view);

  return {
    q: sanitizeLedgerSearch(firstSearchParamOrEmpty(raw.q)),
    month: MONTH_RE.test(monthValue) ? monthValue : "",
    day: DAY_RE.test(dayValue) ? dayValue : "",
    year: YEAR_RE.test(yearValue) ? yearValue : "",
    accountId: UUID_RE.test(accountValue) ? accountValue : "",
    category: CATEGORY_RE.test(categoryValue) ? categoryValue : "",
    sub: CATEGORY_RE.test(subValue) ? subValue : "",
    merchant: sanitizeLedgerSearch(firstSearchParamOrEmpty(raw.merchant)),
    flow: flowValue === "in" || flowValue === "out" ? flowValue : "",
    accountType:
      accountTypeValue === "depository" || accountTypeValue === "credit"
        ? accountTypeValue
        : "",
    review:
      reviewValue === "needs_review" || reviewValue === "reviewed"
        ? reviewValue
        : "all",
    view: viewValue === "calendar" ? "calendar" : "list",
    sort: LEDGER_SORT_FIELDS.includes(sortValue as LedgerSortField)
      ? (sortValue as LedgerSortField)
      : "date",
    direction:
      directionValue === "asc" || directionValue === "desc"
        ? directionValue
        : "desc",
    page: Math.max(1, Number.parseInt(firstSearchParamOrEmpty(raw.page), 10) || 1),
    columns: parseLedgerColumns({
      col: raw.col,
      colsSubmitted: raw.colsSubmitted,
    }),
    columnsSubmitted: Boolean(firstSearchParamOrEmpty(raw.colsSubmitted)),
  };
}

export function ledgerQueryEntries(
  state: LedgerQueryState,
): LedgerQueryEntry[] {
  const entries: LedgerQueryEntry[] = [];

  for (const key of FILTER_KEYS) {
    const value = state[key];
    if (key === "review" && value === "all") continue;
    if (value) entries.push([key, value]);
  }
  if (state.sort !== "date") entries.push(["sort", state.sort]);
  if (state.direction !== "desc") {
    entries.push(["direction", state.direction]);
  }
  if (state.page > 1) entries.push(["page", String(state.page)]);
  entries.push(...ledgerColumnEntries(state));
  if (state.view === "calendar") entries.push(["view", "calendar"]);

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
