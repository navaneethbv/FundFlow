import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
import { loadCanonicalProjection } from "@/lib/finance-query";
import {
  parseFinancialScope,
  type FinancialScope,
} from "@/lib/financial-scope";
import {
  applyReportFilters,
  endExclusiveFor,
  type ReportFilters,
} from "@/lib/reports";

/**
 * The one place the Reports surface turns a filter into rows. The page and
 * `/api/export/report-csv` both call this, so a CSV download always contains
 * exactly the row set the chart above it was drawn from — the reconciliation
 * the Phase 6 E2E check asserts.
 *
 * The read is bounded by `loadCanonicalProjection` (it pages to
 * `FINANCE_MAX_ROWS` and reports `truncated`), so a user picking a ten-year
 * range degrades to "we told you it is incomplete" rather than an unbounded
 * select.
 */

export interface ReportDataResult {
  transactions: CanonicalFinanceTransaction[];
  currencyByAccountId: Map<string, string>;
  /** True when the bounded read cut the range short. */
  truncated: boolean;
}

export async function loadReportData(
  supabase: SupabaseClient,
  options: Readonly<{ scope: FinancialScope; filters: ReportFilters }>,
): Promise<ReportDataResult> {
  const { transactions, currencyByAccountId, truncated } =
    await loadCanonicalProjection(supabase, {
      scope: options.scope,
      window: {
        start: options.filters.start,
        endExclusive: endExclusiveFor(options.filters.end),
      },
      excludePending: options.filters.excludePending,
    });

  return {
    // The window above is a coarse bound; applyReportFilters is what enforces
    // the exact inclusive range plus the account/merchant/category choices.
    transactions: applyReportFilters(transactions, options.filters),
    currencyByAccountId,
    truncated,
  };
}

export interface ResolvedReportScope {
  scope: FinancialScope;
  visibleHouseholdIds: string[];
}

/**
 * Resolve `?scope=` against the households RLS actually exposes. A guessed or
 * stale id degrades to the caller's own rows — `parseFinancialScope` will not
 * honour an id that is not in this list.
 */
export async function resolveReportScope(
  supabase: SupabaseClient,
  ownerUserId: string,
  raw: string | string[] | undefined,
): Promise<ResolvedReportScope> {
  const { data, error } = await supabase.from("households").select("id");
  if (error) throw error;
  const visibleHouseholdIds = (data ?? []).map((row) => row.id as string);
  return {
    scope: parseFinancialScope({ raw, ownerUserId, visibleHouseholdIds }),
    visibleHouseholdIds,
  };
}

export interface SavedReportRow {
  id: string;
  name: string;
  report_type: string;
  filters: unknown;
}

/** The caller's saved reports, newest edit first. */
export async function loadSavedReports(
  supabase: SupabaseClient,
  userId: string,
  limit = 50,
): Promise<SavedReportRow[]> {
  const { data, error } = await supabase
    .from("saved_reports")
    .select("id, name, report_type, filters")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SavedReportRow[];
}
