import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromTransactionRow, UNCATEGORIZED, type TransactionRow } from "@/lib/finance-domain";

const PAGE_SIZE = 1_000;
const ANNOTATION_CHUNK_SIZE = 250;
const DEPENDENCY_CONCURRENCY = 6;

type ExportQueryResult = { data?: unknown; error?: unknown };

function assertExportQuery(result: ExportQueryResult): void {
  if (result.error) throw result.error;
}

async function loadPagedRows<T>(
  loadPage: (from: number, to: number) => PromiseLike<ExportQueryResult>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE;
    const result = await loadPage(from, from + PAGE_SIZE - 1);
    assertExportQuery(result);
    const batch = (result.data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function runBatched<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = DEPENDENCY_CONCURRENCY,
): Promise<T[]> {
  const results: T[] = [];
  for (let index = 0; index < tasks.length; index += concurrency) {
    results.push(...(await Promise.all(tasks.slice(index, index + concurrency).map((task) => task()))));
  }
  return results;
}

async function loadChunkedRows<T>(
  transactionIds: string[],
  loadPage: (
    ids: string[],
    from: number,
    to: number,
  ) => PromiseLike<ExportQueryResult>,
): Promise<T[]> {
  const tasks = chunks(transactionIds, ANNOTATION_CHUNK_SIZE).map(
    (ids) => () => loadPagedRows<T>((from, to) => loadPage(ids, from, to)),
  );
  return (await runBatched(tasks)).flat();
}

/**
 * The privacy-safe export contract shared by the CSV and JSON endpoints:
 * date / merchant / amount / category only — no account numbers, tokens, or
 * identifiers. Queries run with the caller's RLS-scoped client and respect
 * the profile's ai_export_enabled opt-out.
 */

export interface ExportRow {
  date: string;
  merchant: string;
  amount: number;
  category: string;
}

export type ExportFetchResult =
  | { allowed: false }
  | { allowed: true; rows: ExportRow[] };

export interface ExportFetchOptions {
  startDate?: string;
}

/** First day of the current month minus five months, in UTC. */
export function recentHistoryStart(now = new Date()): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  return start.toISOString().slice(0, 10);
}

/**
 * Resolve the `ai_export_enabled` opt-out for a user, failing closed.
 *
 * A missing profile row or a failed profile read denies the export instead of
 * silently allowing it. The export routes already wrap their work in
 * try/catch, so a read error here surfaces as the route's explicit error
 * response; a missing profile returns `false` and the route answers 403.
 */
async function readExportPreference(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("ai_export_enabled")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return false;
  return profile.ai_export_enabled !== false;
}

/**
 * The `ai_export_enabled` opt-out on its own, for exports that build their own
 * row set (the Reports CSV filters the canonical projection rather than reading
 * `transactions` directly) but must still honour the same gate.
 */
export async function isExportAllowed(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  return readExportPreference(supabase, userId);
}

export async function fetchPrivacySafeRows(
  supabase: SupabaseClient,
  userId: string,
  options: ExportFetchOptions = {},
): Promise<ExportFetchResult> {
  if (!(await readExportPreference(supabase, userId))) {
    return { allowed: false };
  }

  // Explicit user scoping: redundant under the RLS-bound client, but this
  // function is also called with the service client for API-token requests,
  // where this filter is the only thing standing between users.
  const txns = await loadPagedRows<TransactionRow>((from, to) => {
    let query = supabase
      .from("transactions")
      .select("id, user_id, account_id, manual_account_id, plaid_transaction_id, date, merchant_name, name, amount, pfc_primary, pfc_detailed, pending")
      .eq("user_id", userId);
    if (options.startDate) query = query.gte("date", options.startDate);
    return query
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
  });

  // The export consumes the same canonical projection as every other surface,
  // so a transaction-level classification override shows up in CSV/JSON
  // exports exactly as it does in Dashboard, Cash Flow, Reports, and Budget.
  const canonical = await loadCanonicalRows(supabase, userId, txns);

  // projectFinanceTransactions sorts ascending for its paginated consumers,
  // but the export contract has always handed back newest-first.
  const rows: ExportRow[] = canonical
    .toSorted(
      (a, b) =>
        b.date.localeCompare(a.date) || b.sourceTransactionId.localeCompare(a.sourceTransactionId),
    )
    .map((row) => ({
      date: row.date,
      merchant: row.merchant || "",
      amount: row.signedAmount,
      category: row.categoryKey === UNCATEGORIZED ? "" : row.categoryKey,
    }));
  return { allowed: true, rows };
}

/**
 * Load the canonical projected rows for a bounded transaction set, including
 * the caller's classification overrides. Bounded by the same page rule used
 * everywhere else: never an unbounded select on a table that grows forever.
 */
async function loadCanonicalRows(
  supabase: SupabaseClient,
  userId: string,
  rows: TransactionRow[],
): Promise<
  Array<{
    sourceTransactionId: string;
    date: string;
    merchant: string;
    signedAmount: number;
    categoryKey: string;
  }>
> {
  const txnIds = rows.map((row) => row.id);
  const [
    overrides,
    splits,
    rules,
    categoryOverrides,
    linkedRefunds,
    linkedDuplicates,
    accounts,
  ] = await Promise.all([
    loadChunkedRows<{
      transaction_id: string;
      display_category: string | null;
      cash_flow_classification: "expense" | "income" | null;
    }>(txnIds, (transactionIds, from, to) =>
      supabase
        .from("transaction_annotations")
        .select("transaction_id, display_category, cash_flow_classification")
        .in("transaction_id", transactionIds)
        .eq("user_id", userId)
        .order("transaction_id")
        .range(from, to),
    ),
    loadChunkedRows<{
      transaction_id: string;
      category: string;
      amount: number;
    }>(txnIds, (transactionIds, from, to) =>
      supabase
        .from("transaction_splits")
        .select("transaction_id, category, amount")
        .in("transaction_id", transactionIds)
        .eq("user_id", userId)
        .order("transaction_id")
        .range(from, to),
    ),
    loadPagedRows<{
      match_type: string;
      pattern: string;
      display_name: string | null;
      category: string | null;
      enabled: boolean;
    }>((from, to) =>
      supabase
        .from("merchant_rules")
        .select("match_type, pattern, display_name, category, enabled")
        .eq("user_id", userId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    loadPagedRows<{ source_category: string; display_category: string }>(
      (from, to) =>
        supabase
          .from("category_overrides")
          .select("source_category, display_category")
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
    ),
    loadPagedRows<{
      charge_transaction_id: string;
      refund_transaction_id: string;
    }>((from, to) =>
      supabase
        .from("linked_refunds")
        .select("charge_transaction_id, refund_transaction_id")
        .eq("user_id", userId)
        .order("id")
        .range(from, to),
    ),
    loadPagedRows<{ excluded_transaction_id: string }>((from, to) =>
      supabase
        .from("linked_duplicates")
        .select("excluded_transaction_id")
        .eq("user_id", userId)
        .order("id")
        .range(from, to),
    ),
    // Merchant rules with matchType "account" match against the account's
    // display name, so the projection needs the same id→name map every other
    // surface passes. Without it those rules silently no-op in the export.
    loadPagedRows<{ id: string; name: string | null }>((from, to) =>
      supabase
        .from("accounts")
        .select("id, name")
        .eq("user_id", userId)
        .order("id")
        .range(from, to),
    ),
  ]);

  const { projectFinanceTransactions } = await import("@/lib/finance-domain");
  const projected = projectFinanceTransactions({
    rows: rows.map(fromTransactionRow),
    accountNames: new Map(accounts.map((account) => [account.id, account.name ?? ""])),
    merchantRules: rules.map((rule) => ({
      matchType: rule.match_type as "merchant" | "keyword" | "account",
      pattern: rule.pattern,
      displayName: rule.display_name,
      category: rule.category,
      enabled: rule.enabled,
    })),
    categoryOverrides: categoryOverrides.map(
      (row) => ({ sourceCategory: row.source_category, displayCategory: row.display_category }),
    ),
    splits: splits.map((row) => ({
      transactionId: row.transaction_id,
      category: row.category,
      amount: Number(row.amount),
    })),
    linkedRefunds: linkedRefunds.map((row) => ({
      chargeTransactionId: row.charge_transaction_id,
      refundTransactionId: row.refund_transaction_id,
    })),
    excludedTransactionIds: new Set(
      linkedDuplicates.map((row) => row.excluded_transaction_id),
    ),
    transactionOverrides: overrides.map((row) => ({
      transactionId: row.transaction_id,
      displayCategory: row.display_category,
      cashFlowClassification:
        row.cash_flow_classification === "expense" || row.cash_flow_classification === "income"
          ? row.cash_flow_classification
          : null,
    })),
  });
  return projected.map((row) => ({
    sourceTransactionId: row.sourceTransactionId,
    date: row.date,
    merchant: row.merchant,
    signedAmount: row.signedAmount,
    categoryKey: row.categoryKey,
  }));
}
