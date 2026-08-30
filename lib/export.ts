import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromTransactionRow, UNCATEGORIZED, type TransactionRow } from "@/lib/finance-domain";

const PAGE_SIZE = 1_000;
const ANNOTATION_CHUNK_SIZE = 250;

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
): Promise<ExportFetchResult> {
  if (!(await readExportPreference(supabase, userId))) {
    return { allowed: false };
  }

  // Explicit user scoping: redundant under the RLS-bound client, but this
  // function is also called with the service client for API-token requests,
  // where this filter is the only thing standing between users.
  const txns = await loadPagedRows<TransactionRow>((from, to) =>
    supabase
      .from("transactions")
      .select("id, user_id, account_id, manual_account_id, plaid_transaction_id, date, merchant_name, name, amount, pfc_primary, pfc_detailed, pending")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );

  // The export consumes the same canonical projection as every other surface,
  // so a transaction-level classification override shows up in CSV/JSON
  // exports exactly as it does in Dashboard, Cash Flow, Reports, and Budget.
  const canonical = await loadCanonicalRows(supabase, userId, txns);

  const rows: ExportRow[] = canonical.map((row) => ({
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
  Array<{ date: string; merchant: string; signedAmount: number; categoryKey: string }>
> {
  const txnIds = rows.map((row) => row.id);
  const annotationQueries = chunks(txnIds, ANNOTATION_CHUNK_SIZE).map(
    (transactionIds) =>
      supabase
        .from("transaction_annotations")
        .select("transaction_id, display_category, cash_flow_classification")
        .in("transaction_id", transactionIds)
        .eq("user_id", userId)
        .order("transaction_id"),
  );
  const [annotationResults, rules, categoryOverrides] = await Promise.all([
    Promise.all(annotationQueries),
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
  ]);
  annotationResults.forEach(assertExportQuery);
  const overrides = annotationResults.flatMap(
    (result) => (result.data ?? []) as Array<{
      transaction_id: string;
      display_category: string | null;
      cash_flow_classification: "expense" | "income" | null;
    }>,
  );

  const { projectFinanceTransactions } = await import("@/lib/finance-domain");
  const projected = projectFinanceTransactions({
    rows: rows.map(fromTransactionRow),
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
    splits: [],
    linkedRefunds: [],
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
    date: row.date,
    merchant: row.merchant,
    signedAmount: row.signedAmount,
    categoryKey: row.categoryKey,
  }));
}
