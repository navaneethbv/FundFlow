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
  "id, user_id, account_id, manual_account_id, plaid_transaction_id, date, amount, merchant_name, name, pfc_primary, pfc_detailed, pending";

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

async function fetchFinancePage(
  supabase: SupabaseClient,
  userId: string | undefined,
  options: FetchFinanceOptions,
  offset: number,
  pageSize: number,
): Promise<TransactionRow[]> {
  let query = supabase.from("transactions").select(FINANCE_TRANSACTION_COLUMNS);
  if (userId) query = query.eq("user_id", userId);
  if (options.excludePending) query = query.eq("pending", false);
  if (options.window) {
    query = query
      .gte("date", options.window.start)
      .lt("date", options.window.endExclusive);
  }
  const { data, error } = await query
    .order("date", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + pageSize - 1);
  if (error) throw error;
  return (data ?? []) as unknown as TransactionRow[];
}

/** Row count for the same filters, so pages can be fetched in parallel. */
async function fetchFinancePageCount(
  supabase: SupabaseClient,
  userId: string | undefined,
  options: FetchFinanceOptions,
): Promise<number> {
  let query = supabase
    .from("transactions")
    .select("id", { count: "exact", head: true });
  if (userId) query = query.eq("user_id", userId);
  if (options.excludePending) query = query.eq("pending", false);
  if (options.window) {
    query = query
      .gte("date", options.window.start)
      .lt("date", options.window.endExclusive);
  }
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Independent page windows may be fetched concurrently; cap the fan-out so a
 *  huge range does not fire dozens of simultaneous requests. */
const PAGE_CONCURRENCY = 6;

export async function fetchFinanceTransactions(
  supabase: SupabaseClient,
  options: FetchFinanceOptions,
): Promise<FinanceFetchResult> {
  const pageSize = options.pageSize ?? FINANCE_PAGE_SIZE;
  const maxRows = options.maxRows ?? FINANCE_MAX_ROWS;
  const userId = scopeQueryUserId(options.scope);
  const maxPages = Math.ceil(maxRows / pageSize);

  // The count is fetched in parallel with page zero, then every remaining page
  // is read concurrently in bounded batches. The old serial walk cost ~30
  // round-trips on a 30k-row range; this brings it down to a couple of batches
  // while keeping the exact same deterministic date+id windows.
  const [count, firstPage] = await Promise.all([
    fetchFinancePageCount(supabase, userId, options),
    fetchFinancePage(supabase, userId, options, 0, pageSize),
  ]);

  const rows: RawFinanceTransaction[] = [];
  for (const row of firstPage) rows.push(fromTransactionRow(row));

  const totalPages = Math.min(maxPages, Math.max(1, Math.ceil(count / pageSize)));
  for (let start = 1; start < totalPages; start += PAGE_CONCURRENCY) {
    const end = Math.min(totalPages, start + PAGE_CONCURRENCY);
    const pages = await Promise.all(
      Array.from({ length: end - start }, (_, index) =>
        fetchFinancePage(supabase, userId, options, (start + index) * pageSize, pageSize),
      ),
    );
    for (const page of pages) {
      for (const row of page) rows.push(fromTransactionRow(row));
    }
  }

  if (rows.length >= maxRows) return { rows: rows.slice(0, maxRows), truncated: true };
  return { rows, truncated: false };
}

export interface CanonicalProjectionResult {
  transactions: import("@/lib/finance-domain").CanonicalFinanceTransaction[];
  currencyByAccountId: Map<string, string>;
  truncated: boolean;
}

function assertProjectionQuery(
  table: string,
  result: { error: { code?: string } | null },
): void {
  if (!result.error) return;
  const suffix = result.error.code ? `:${result.error.code}` : "";
  throw new Error(`finance_projection_query_failed:${table}${suffix}`);
}

interface SplitRow {
  transaction_id: string;
  category: string;
  amount: number | string;
}

type SplitChunkResult = { data: SplitRow[] | null; error: { code?: string } | null };

/** `:CODE` suffix for the thrown error message, or "" when there is none. */
function errorCodeSuffix(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return `:${error.code}`;
  }
  return "";
}

/**
 * Runs a set of independent reads with a concurrency cap, so a wide range can
 * fan out without firing dozens of simultaneous Supabase requests (which
 * trips connection/rate limits and surfaces as a generic query error).
 */
export async function runBatched<T>(
  tasks: ReadonlyArray<() => PromiseLike<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

/** Cap for split-chunk reads and other dependency fan-out. */
export const DEPENDENCY_CONCURRENCY = 6;

/**
 * `transaction_splits` reads chunked transaction ids: PostgREST builds an
 * `in.(...)` list into the URL, and the whole page's ids at once overruns the
 * request line. The chunk is sized so a 36-char UUID list stays comfortably
 * under Node's 16KB header limit (500 ids ≈ 18KB overflowed undici).
 */
const SPLIT_CHUNK_SIZE = 250;

function buildSplitChunkQueries(
  supabase: SupabaseClient,
  txnIds: readonly string[],
  userId: string | null | undefined,
): Array<() => PromiseLike<SplitChunkResult>> {
  const queries: Array<() => PromiseLike<SplitChunkResult>> = [];
  for (let i = 0; i < txnIds.length; i += SPLIT_CHUNK_SIZE) {
    queries.push(() => {
      let splitsQuery = supabase
        .from("transaction_splits")
        .select("transaction_id,category,amount")
        .in("transaction_id", txnIds.slice(i, i + SPLIT_CHUNK_SIZE))
        .limit(2000);
      if (userId) splitsQuery = splitsQuery.eq("user_id", userId);
      return splitsQuery;
    });
  }
  return queries;
}

/** Flattens the per-chunk split rows into the projection's split input. */
function collectSplits(
  chunks: readonly SplitChunkResult[],
): Array<{ transactionId: string; category: string; amount: number }> {
  const splits: Array<{ transactionId: string; category: string; amount: number }> = [];
  for (const chunk of chunks) {
    for (const s of chunk.data ?? []) {
      splits.push({
        transactionId: s.transaction_id,
        category: s.category,
        amount: Number(s.amount),
      });
    }
  }
  return splits;
}

/** Account currency and (where set) display name, keyed by account id. */
function buildAccountMaps(
  accounts: ReadonlyArray<{ id: string; name?: string | null; iso_currency_code?: string | null }>,
): { currencyByAccountId: Map<string, string>; accountNames: Map<string, string> } {
  const currencyByAccountId = new Map<string, string>();
  const accountNames = new Map<string, string>();
  for (const acc of accounts) {
    currencyByAccountId.set(acc.id, String(acc.iso_currency_code ?? "").trim().toUpperCase());
    if (acc.name) accountNames.set(acc.id, acc.name);
  }
  return { currencyByAccountId, accountNames };
}

export async function loadCanonicalProjection(
  supabase: SupabaseClient,
  options: FetchFinanceOptions,
): Promise<CanonicalProjectionResult> {
  const userId = scopeQueryUserId(options.scope);
  let fetchResult: FinanceFetchResult;
  try {
    fetchResult = await fetchFinanceTransactions(supabase, options);
  } catch (error) {
    throw new Error(`finance_projection_query_failed:transactions${errorCodeSuffix(error)}`);
  }
  const txnIds = fetchResult.rows.map((r) => r.id);

  let accountsQuery = supabase
    .from("accounts")
    .select("id,name,iso_currency_code")
    .limit(5000);
  let rulesQuery = supabase
    .from("merchant_rules")
    .select("match_type,pattern,display_name,category,enabled")
    .order("created_at")
    .limit(5000);
  let overridesQuery = supabase
    .from("category_overrides")
    .select("source_category,display_category")
    .order("source_category")
    .limit(5000);
  let refundsQuery = supabase
    .from("linked_refunds")
    .select("charge_transaction_id,refund_transaction_id")
    .order("charge_transaction_id")
    .limit(FINANCE_MAX_ROWS);
  let duplicatesQuery = supabase
    .from("linked_duplicates")
    .select("excluded_transaction_id")
    .order("created_at")
    .limit(FINANCE_MAX_ROWS);

  if (userId) {
    accountsQuery = accountsQuery.eq("user_id", userId);
    rulesQuery = rulesQuery.eq("user_id", userId);
    overridesQuery = overridesQuery.eq("user_id", userId);
    refundsQuery = refundsQuery.eq("user_id", userId);
    duplicatesQuery = duplicatesQuery.eq("user_id", userId);
  }

  const splitChunksPromises = buildSplitChunkQueries(supabase, txnIds, userId);

  // The split-chunk batch is one element of the Promise.all, not an awaited
  // spread: awaiting it here would finish every chunk read before the five
  // dependency queries even start.
  const [accountsRes, rulesRes, overridesRes, refundsRes, duplicatesRes, splitResChunks] =
    await Promise.all([
      accountsQuery,
      rulesQuery,
      overridesQuery,
      refundsQuery,
      duplicatesQuery,
      runBatched(splitChunksPromises, DEPENDENCY_CONCURRENCY),
    ]);

  assertProjectionQuery("accounts", accountsRes);
  assertProjectionQuery("merchant_rules", rulesRes);
  assertProjectionQuery("category_overrides", overridesRes);
  assertProjectionQuery("linked_refunds", refundsRes);
  assertProjectionQuery("linked_duplicates", duplicatesRes);
  for (const sRes of splitResChunks) {
    assertProjectionQuery("transaction_splits", sRes);
  }

  const { currencyByAccountId, accountNames } = buildAccountMaps(accountsRes.data ?? []);

  const merchantRules = ((rulesRes.data || []) as Array<{
    match_type: "merchant" | "keyword" | "account";
    pattern: string;
    display_name: string | null;
    category: string | null;
    enabled: boolean;
  }>).map((r) => ({
    matchType: r.match_type,
    pattern: r.pattern,
    displayName: r.display_name,
    category: r.category,
    enabled: r.enabled,
  }));

  const categoryOverrides = ((overridesRes.data || []) as Array<{
    source_category: string;
    display_category: string;
  }>).map((c) => ({
    sourceCategory: c.source_category,
    displayCategory: c.display_category,
  }));

  const linkedRefunds = ((refundsRes.data || []) as Array<{
    charge_transaction_id: string;
    refund_transaction_id: string;
  }>).map((rf) => ({
    chargeTransactionId: rf.charge_transaction_id,
    refundTransactionId: rf.refund_transaction_id,
  }));

  const splits = collectSplits(splitResChunks);

  const { projectFinanceTransactions } = await import("@/lib/finance-domain");

  return {
    transactions: projectFinanceTransactions({
      rows: fetchResult.rows,
      accountNames,
      merchantRules,
      categoryOverrides,
      splits,
      linkedRefunds,
      excludedTransactionIds: new Set(
        ((duplicatesRes.data ?? []) as Array<{ excluded_transaction_id: string }>)
          .map((row) => row.excluded_transaction_id),
      ),
    }),
    currencyByAccountId,
    truncated: fetchResult.truncated,
  };
}
