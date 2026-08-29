import type { SupabaseClient } from "@supabase/supabase-js";
import {
  projectFinanceTransactions,
  type CanonicalFinanceTransaction,
  type LinkedRefundPair,
} from "@/lib/finance-domain";
import {
  fetchFinanceTransactions,
  FINANCE_MAX_ROWS,
  monthWindow,
  runBatched,
  DEPENDENCY_CONCURRENCY,
} from "@/lib/finance-query";
import {
  scopeQueryUserId,
  type FinancialScope,
} from "@/lib/financial-scope";
import type { CategoryOverrideRow } from "@/lib/insights";
import type { MerchantRule } from "@/lib/planning";
import type { TransactionSplit } from "@/lib/transaction-quality";

const DEPENDENCY_LIMIT = 5_000;
const REFUND_LIMIT = FINANCE_MAX_ROWS;
/** Sized so the `in.(...)` URL stays under Node's 16KB header limit. */
const SPLIT_CHUNK_SIZE = 250;

export interface CashFlowLoadOptions {
  scope: FinancialScope;
  anchorMonth: string;
  rangeMonths: 6 | 12 | 24;
  now?: Date;
}

export interface CashFlowLoadResult {
  transactions: CanonicalFinanceTransaction[];
  currencyByAccountId: Map<string, string>;
  truncated: boolean;
  lastSuccessfulSyncAt: string | null;
  stale: boolean;
}

interface AccountRow {
  id: string;
  name: string | null;
  iso_currency_code: string | null;
}

interface MerchantRuleRow {
  match_type: "merchant" | "keyword" | "account";
  pattern: string;
  display_name: string | null;
  category: string | null;
  enabled: boolean;
}

interface CategoryOverrideDbRow {
  source_category: string;
  display_category: string;
}

interface SplitRow {
  transaction_id: string;
  category: string;
  amount: number | string;
}

interface RefundRow {
  charge_transaction_id: string;
  refund_transaction_id: string;
}

interface SyncRow {
  updated_at: string;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function assertQuery(
  name: string,
  result: { error: { code?: string } | null },
): void {
  if (!result.error) return;
  const code = result.error.code ? `:${result.error.code}` : "";
  throw new Error(`cash_flow_query_failed:${name}${code}`);
}

function isStale(lastSuccessfulSyncAt: string | null, now: Date): boolean {
  if (!lastSuccessfulSyncAt) return true;
  const timestamp = Date.parse(lastSuccessfulSyncAt);
  if (!Number.isFinite(timestamp)) return true;
  return now.getTime() - timestamp > 48 * 60 * 60 * 1000;
}

export async function loadCashFlowData(
  supabase: SupabaseClient,
  options: CashFlowLoadOptions,
): Promise<CashFlowLoadResult> {
  const userId = scopeQueryUserId(options.scope);
  const financeResult = await fetchFinanceTransactions(supabase, {
    scope: options.scope,
    window: monthWindow(options.anchorMonth, options.rangeMonths - 1),
    maxRows: FINANCE_MAX_ROWS,
  });

  let accountsQuery = supabase
    .from("accounts")
    .select("id,name,iso_currency_code")
    .order("id")
    .limit(DEPENDENCY_LIMIT);
  let rulesQuery = supabase
    .from("merchant_rules")
    .select("match_type,pattern,display_name,category,enabled")
    .order("created_at")
    .limit(DEPENDENCY_LIMIT);
  let overridesQuery = supabase
    .from("category_overrides")
    .select("source_category,display_category")
    .order("source_category")
    .limit(DEPENDENCY_LIMIT);
  let refundsQuery = supabase
    .from("linked_refunds")
    .select("charge_transaction_id,refund_transaction_id")
    .order("charge_transaction_id")
    .limit(REFUND_LIMIT);
  let duplicatesQuery = supabase
    .from("linked_duplicates")
    .select("excluded_transaction_id")
    .order("created_at")
    .limit(REFUND_LIMIT);
  let syncQuery = supabase
    .from("sync_jobs")
    .select("updated_at")
    .eq("status", "done")
    .eq("job_type", "transactions")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (userId) {
    accountsQuery = accountsQuery.eq("user_id", userId);
    rulesQuery = rulesQuery.eq("user_id", userId);
    overridesQuery = overridesQuery.eq("user_id", userId);
    refundsQuery = refundsQuery.eq("user_id", userId);
    duplicatesQuery = duplicatesQuery.eq("user_id", userId);
    syncQuery = syncQuery.eq("user_id", userId);
  }
  const syncSingleQuery = syncQuery.maybeSingle();

  const sourceTransactionIds = financeResult.rows.map((row) => row.id);
  const splitTasks = chunks(
    sourceTransactionIds,
    SPLIT_CHUNK_SIZE,
  ).map((transactionIds) => () => {
    let query = supabase
      .from("transaction_splits")
      .select("transaction_id,category,amount")
      .in("transaction_id", transactionIds)
      .limit(SPLIT_CHUNK_SIZE * 4);
    if (userId) query = query.eq("user_id", userId);
    return query;
  });

  const [
    accountsResult,
    rulesResult,
    overridesResult,
    refundsResult,
    duplicatesResult,
    syncResult,
    splitResults,
  ] = await Promise.all([
    accountsQuery,
    rulesQuery,
    overridesQuery,
    refundsQuery,
    duplicatesQuery,
    syncSingleQuery,
    runBatched(splitTasks, DEPENDENCY_CONCURRENCY),
  ]);

  assertQuery("accounts", accountsResult);
  assertQuery("merchant_rules", rulesResult);
  assertQuery("category_overrides", overridesResult);
  assertQuery("linked_refunds", refundsResult);
  assertQuery("linked_duplicates", duplicatesResult);
  assertQuery("sync_jobs", syncResult);
  splitResults.forEach((result) =>
    assertQuery("transaction_splits", result),
  );

  const accounts = (accountsResult.data ?? []) as AccountRow[];
  const merchantRules: MerchantRule[] = (
    (rulesResult.data ?? []) as MerchantRuleRow[]
  ).map((row) => ({
    matchType: row.match_type,
    pattern: row.pattern,
    displayName: row.display_name,
    category: row.category,
    enabled: row.enabled,
  }));
  const categoryOverrides: CategoryOverrideRow[] = (
    (overridesResult.data ?? []) as CategoryOverrideDbRow[]
  ).map((row) => ({
    sourceCategory: row.source_category,
    displayCategory: row.display_category,
  }));
  const splits: TransactionSplit[] = splitResults.flatMap((result) =>
    ((result.data ?? []) as SplitRow[]).map((row) => ({
      transactionId: row.transaction_id,
      category: row.category,
      amount: Number(row.amount),
    })),
  );
  const linkedRefunds: LinkedRefundPair[] = (
    (refundsResult.data ?? []) as RefundRow[]
  ).map((row) => ({
    chargeTransactionId: row.charge_transaction_id,
    refundTransactionId: row.refund_transaction_id,
  }));
  const accountNames = new Map(
    accounts.map((row) => [row.id, row.name ?? ""]),
  );
  // Every account is present, including ones with a null currency code —
  // `currencyFor` maps a blank code to USD exactly like the Accounts page.
  // Dropping them here would instead bucket their rows as "Unknown currency".
  const currencyByAccountId = new Map(
    accounts.map((row) => [
      row.id,
      (row.iso_currency_code ?? "").trim().toUpperCase(),
    ]),
  );
  const lastSuccessfulSyncAt =
    ((syncResult.data as SyncRow | null)?.updated_at as string | undefined) ??
    null;

  return {
    transactions: projectFinanceTransactions({
      rows: financeResult.rows,
      merchantRules,
      categoryOverrides,
      splits,
      linkedRefunds,
      excludedTransactionIds: new Set(
        ((duplicatesResult.data ?? []) as Array<{ excluded_transaction_id: string }>)
          .map((row) => row.excluded_transaction_id),
      ),
      accountNames,
    }),
    currencyByAccountId,
    truncated: financeResult.truncated,
    lastSuccessfulSyncAt,
    stale: isStale(lastSuccessfulSyncAt, options.now ?? new Date()),
  };
}
