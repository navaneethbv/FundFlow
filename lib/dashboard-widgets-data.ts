import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeCumulativeSpendByDay,
  shiftMonthKey,
  type CumulativeSpendDay,
} from "@/lib/dashboard";
import { loadCanonicalProjection } from "@/lib/finance-query";
import { formatMonth } from "@/lib/format";

/**
 * The one extra read the Phase 8 widget grid needs.
 *
 * `getDashboardData` does not return canonical rows, and the cumulative-spend
 * widget compares two whole months day by day, so it loads its own bounded
 * window. Kept out of `app/dashboard/page.tsx` so that page stays the
 * orchestrator its own test insists on rather than growing a data layer.
 *
 * Only called for the overview view: the other three never render this widget
 * and must not pay for the query, which matters because the dashboard
 * re-renders every two minutes.
 */

export interface CumulativeSpendView {
  days: CumulativeSpendDay[];
  monthLabel: string;
  previousMonthLabel: string;
}

export async function loadCumulativeSpend(
  supabase: SupabaseClient,
  options: Readonly<{
    month: string;
    today: string;
    userId: string;
    household: boolean;
  }>,
): Promise<CumulativeSpendView> {
  const previousMonth = shiftMonthKey(options.month, -1);

  const { transactions } = await loadCanonicalProjection(supabase, {
    // `scopeQueryUserId` only distinguishes mine from household: household
    // drops the user_id filter so RLS blends in shared rows, and the id itself
    // never reaches the query.
    scope: options.household
      ? { kind: "household", householdId: "dashboard" }
      : { kind: "mine", ownerUserId: options.userId },
    window: {
      start: `${previousMonth}-01`,
      endExclusive: `${shiftMonthKey(options.month, 1)}-01`,
    },
  });

  return {
    days: computeCumulativeSpendByDay(transactions, options.month, options.today),
    monthLabel: formatMonth(options.month),
    previousMonthLabel: formatMonth(previousMonth),
  };
}

/** What the grid shows before its data is loaded, or when it is not needed. */
export const EMPTY_CUMULATIVE_SPEND: CumulativeSpendView = {
  days: [],
  monthLabel: "",
  previousMonthLabel: "",
};
