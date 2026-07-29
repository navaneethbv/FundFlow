import type { SupabaseClient } from "@supabase/supabase-js";
import { fromTransactionRow, type RawFinanceTransaction, type TransactionRow } from "@/lib/finance-domain";
import { scopeQueryUserId, type FinancialScope } from "@/lib/financial-scope";

/**
 * Bounded, column-explicit reads for the canonical projection.
 *
 * Two rules exist here so no page can regress them: never `select("*")` on a
 * table that grows forever, and never issue an unbounded read — the dashboard
 * re-renders every two minutes, so an all-time select multiplies with time.
 */

export const FINANCE_TRANSACTION_COLUMNS =
  "id, user_id, account_id, plaid_transaction_id, date, amount, merchant_name, name, pfc_primary, pfc_detailed, pending";

/** Supabase caps a single range request; page well under it. */
export const FINANCE_PAGE_SIZE = 1000;

/** Hard ceiling for one request. Callers needing more must page deliberately. */
export const FINANCE_MAX_ROWS = 25_000;

export interface FinanceWindow {
  /** Inclusive `YYYY-MM-DD`. */
  start: string;
  /** Exclusive `YYYY-MM-DD`. */
  endExclusive: string;
}

/** "2026-07" + delta months, pure string math (no timezone surprises). */
function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y! * 12 + (m! - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** The window covering `anchorMonth` and the `monthsBack` months before it. */
export function monthWindow(anchorMonth: string, monthsBack: number): FinanceWindow {
  return {
    start: `${addMonths(anchorMonth, -monthsBack)}-01`,
    endExclusive: `${addMonths(anchorMonth, 1)}-01`,
  };
}

export interface FetchFinanceOptions {
  scope: FinancialScope;
  window?: FinanceWindow;
  /** Default false: pending rows count in every total (see finance-domain). */
  excludePending?: boolean;
  pageSize?: number;
  maxRows?: number;
}

export interface FinanceFetchResult {
  rows: RawFinanceTransaction[];
  /** True when `maxRows` cut the read short, so callers can say so honestly. */
  truncated: boolean;
}

export async function fetchFinanceTransactions(
  supabase: SupabaseClient,
  options: FetchFinanceOptions,
): Promise<FinanceFetchResult> {
  const pageSize = options.pageSize ?? FINANCE_PAGE_SIZE;
  const maxRows = options.maxRows ?? FINANCE_MAX_ROWS;
  const userId = scopeQueryUserId(options.scope);

  const rows: RawFinanceTransaction[] = [];
  let offset = 0;

  for (;;) {
    let query = supabase.from("transactions").select(FINANCE_TRANSACTION_COLUMNS);
    if (userId) query = query.eq("user_id", userId);
    if (options.excludePending) query = query.eq("pending", false);
    if (options.window) {
      query = query.gte("date", options.window.start).lt("date", options.window.endExclusive);
    }

    const { data, error } = await query
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const page = (data ?? []) as unknown as TransactionRow[];
    for (const row of page) rows.push(fromTransactionRow(row));

    if (page.length < pageSize) return { rows, truncated: false };
    if (rows.length >= maxRows) return { rows: rows.slice(0, maxRows), truncated: true };
    offset += pageSize;
  }
}
