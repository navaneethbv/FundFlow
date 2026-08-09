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
