import type {
  LedgerSortDirection,
  LedgerSortField,
} from "@/lib/ledger-query";
import {
  filterProjectedLedgerRows,
  sortLedgerRows,
  type LedgerProjectedRow,
} from "@/lib/ledger-projection";

export interface LedgerChunkResult<T> {
  rows: T[];
  error: { code?: string; message?: string } | null;
}

export async function collectLedgerChunks<T>(
  load: (from: number, to: number) => Promise<LedgerChunkResult<T>>,
  chunkSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += chunkSize) {
    const result = await load(from, from + chunkSize - 1);
    if (result.error) {
      throw new Error(
        result.error.code || result.error.message || "ledger_query_failed",
      );
    }
    rows.push(...result.rows);
    if (result.rows.length < chunkSize) return rows;
  }
}

export function ledgerDatabaseOrder(
  sort: Extract<LedgerSortField, "date" | "amount">,
  direction: LedgerSortDirection,
): Array<{
  column: "date" | "amount" | "id";
  ascending: boolean;
}> {
  if (sort === "amount") {
    return [
      { column: "amount", ascending: direction === "desc" },
      { column: "date", ascending: false },
      { column: "id", ascending: true },
    ];
  }
  return [
    { column: "date", ascending: direction === "asc" },
    { column: "id", ascending: true },
  ];
}

export function needsProjectedLedgerPage(
  sort: LedgerSortField,
  ruleAwareDisplayFilter: boolean,
): boolean {
  return (
    ruleAwareDisplayFilter ||
    sort === "merchant" ||
    sort === "category" ||
    sort === "account"
  );
}

export function shouldShowLedgerDayGroups(sort: LedgerSortField): boolean {
  return sort === "date";
}

/**
 * Zebra-band index per row, restarting at zero on each new day when grouping
 * is active so the stripes line up with the groups they organise.
 *
 * Computed up front rather than with a counter threaded through the render,
 * which would mean reassigning a variable mid-render.
 */
export function ledgerZebraBands(
  rows: readonly { date: string }[],
  grouped: boolean,
): number[] {
  const bands: number[] = [];
  for (const [index, row] of rows.entries()) {
    const startsDay = grouped && index > 0 && rows[index - 1]!.date !== row.date;
    bands.push(index === 0 || startsDay ? 0 : bands[index - 1]! + 1);
  }
  return bands;
}

export interface LedgerGroupableRow {
  id: string;
  date: string;
  /** Plaid convention: positive is money out. */
  amount: number;
}

export interface LedgerDayGroup {
  date: string;
  net: number;
  /** Rows for this date present on the current page. */
  visibleCount: number;
  /** Whether every row for this date is on this page. */
  complete: boolean;
  /**
   * Whether the net is worth printing. False for a one-row day, where it would
   * restate the amount directly below it, and false for a day split across a
   * page boundary, where a partial sum labelled as a daily total would be wrong.
   */
  showNet: boolean;
}

/**
 * Day-group metadata shared by every register surface, so the desktop table,
 * the phone card list, and the report table cannot disagree about a day's net.
 *
 * Pass `allRows` (the full filtered set, not just the page) wherever it is
 * available so page-boundary splits are detected. Without it a group is
 * assumed complete, which is only safe when the caller has no wider set to
 * compare against.
 */
export function buildLedgerDayGroups(
  pageRows: readonly LedgerGroupableRow[],
  options: Readonly<{
    allRows?: readonly LedgerGroupableRow[];
    excludedIds?: ReadonlySet<string>;
    incompleteDates?: ReadonlySet<string>;
  }> = {},
): Map<string, LedgerDayGroup> {
  const excludedIds = options.excludedIds;
  const incompleteDates = options.incompleteDates;

  const totalPerDate = new Map<string, number>();
  for (const row of options.allRows ?? []) {
    totalPerDate.set(row.date, (totalPerDate.get(row.date) ?? 0) + 1);
  }

  const groups = new Map<string, LedgerDayGroup>();
  for (const row of pageRows) {
    const previous = groups.get(row.date);
    const counted = !excludedIds?.has(row.id);
    groups.set(row.date, {
      date: row.date,
      net: (previous?.net ?? 0) + (counted ? row.amount : 0),
      visibleCount: (previous?.visibleCount ?? 0) + 1,
      complete: true,
      showNet: false,
    });
  }

  for (const [date, group] of groups) {
    const complete = options.allRows
      ? (totalPerDate.get(date) ?? 0) === group.visibleCount
      : !incompleteDates?.has(date);
    groups.set(date, {
      ...group,
      complete,
      showNet: complete && group.visibleCount > 1,
    });
  }

  return groups;
}

export function selectProjectedLedgerPage<T extends LedgerProjectedRow>(
  rows: T[],
  input: {
    category: string;
    sub: string;
    merchant: string;
    sort: LedgerSortField;
    direction: LedgerSortDirection;
    page: number;
    pageSize: number;
  },
): { rows: T[]; total: number } {
  const filtered = filterProjectedLedgerRows(rows, input);
  const ordered = sortLedgerRows(filtered, input.sort, input.direction);
  const offset = (input.page - 1) * input.pageSize;
  return {
    rows: ordered.slice(offset, offset + input.pageSize),
    total: ordered.length,
  };
}
