import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type CanonicalFinanceTransaction,
} from "@/lib/finance-domain";
import {
  loadCanonicalProjection,
  monthWindow,
} from "@/lib/finance-query";
import {
  scopeQueryUserId,
  type FinancialScope,
} from "@/lib/financial-scope";

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

interface SyncRow {
  updated_at: string;
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
  let syncQuery = supabase
    .from("sync_jobs")
    .select("updated_at")
    .eq("status", "done")
    .eq("job_type", "transactions")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (userId) {
    syncQuery = syncQuery.eq("user_id", userId);
  }
  const syncSingleQuery = syncQuery.maybeSingle();
  let projectionResult;
  let syncResult;
  try {
    [projectionResult, syncResult] = await Promise.all([
      loadCanonicalProjection(supabase, {
        scope: options.scope,
        window: monthWindow(options.anchorMonth, options.rangeMonths - 1),
      }),
      syncSingleQuery,
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("finance_projection_query_failed:")
    ) {
      throw new Error(error.message.replace("finance_projection_query_failed:", "cash_flow_query_failed:"));
    }
    throw error;
  }

  assertQuery("sync_jobs", syncResult);
  const lastSuccessfulSyncAt =
    ((syncResult.data as SyncRow | null)?.updated_at as string | undefined) ??
    null;

  return {
    transactions: projectionResult.transactions,
    currencyByAccountId: projectionResult.currencyByAccountId,
    truncated: projectionResult.truncated,
    lastSuccessfulSyncAt,
    stale: isStale(lastSuccessfulSyncAt, options.now ?? new Date()),
  };
}
