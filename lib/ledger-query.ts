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

export interface LedgerRawSearchParams {
  month?: string | string[];
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
}

export interface LedgerFilters {
  q: string;
  month: string;
  accountId: string;
  category: string;
  sub: string;
  merchant: string;
  flow: "" | "in" | "out";
  accountType: "" | "depository" | "credit";
}

export interface LedgerQueryState extends LedgerFilters {
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
const FILTER_KEYS = [
  "q",
  "month",
  "accountId",
  "category",
  "sub",
  "merchant",
  "flow",
  "accountType",
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
  const accountValue = firstSearchParamOrEmpty(raw.accountId);
  const categoryValue = firstSearchParamOrEmpty(raw.category);
  const subValue = firstSearchParamOrEmpty(raw.sub);
  const flowValue = firstSearchParamOrEmpty(raw.flow);
  const accountTypeValue = firstSearchParamOrEmpty(raw.accountType);

  return {
    q: sanitizeLedgerSearch(firstSearchParamOrEmpty(raw.q)),
    month: MONTH_RE.test(monthValue) ? monthValue : "",
    accountId: UUID_RE.test(accountValue) ? accountValue : "",
    category: CATEGORY_RE.test(categoryValue) ? categoryValue : "",
    sub: CATEGORY_RE.test(subValue) ? subValue : "",
    merchant: sanitizeLedgerSearch(firstSearchParamOrEmpty(raw.merchant)),
    flow: flowValue === "in" || flowValue === "out" ? flowValue : "",
    accountType:
      accountTypeValue === "depository" || accountTypeValue === "credit"
        ? accountTypeValue
        : "",
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
    if (value) entries.push([key, value]);
  }
  if (state.sort !== "date") entries.push(["sort", state.sort]);
  if (state.direction !== "desc") {
    entries.push(["direction", state.direction]);
  }
  if (state.page > 1) entries.push(["page", String(state.page)]);
  if (state.columnsSubmitted) {
    entries.push(["colsSubmitted", "1"]);
    for (const column of LEDGER_COLUMNS) {
      if (state.columns.has(column)) entries.push(["col", column]);
    }
  }

  return entries;
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
    if (value) params[key] = value;
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
  return FILTER_KEYS.some((key) => Boolean(filters[key]));
}
