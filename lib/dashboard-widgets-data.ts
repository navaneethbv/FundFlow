import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeCumulativeSpendByDay,
  shiftMonthKey,
  type CumulativeSpendDay,
} from "@/lib/dashboard";
import { loadCanonicalProjection } from "@/lib/finance-query";
import { formatMonth } from "@/lib/format";
import { buildInvestmentsPage, buildInvestmentAccountCoverage } from "@/lib/investments";
import {
  loadHoldings,
  loadHoldingSnapshots,
  loadInvestmentAccounts,
} from "@/lib/investments-data";
import type { WidgetKey } from "@/lib/dashboard-widgets";
import {
  loadLedgerStripTicks,
  pickAnchorAccount,
  listAnchorableAccounts,
  type LedgerStripAccount,
  type LedgerTick,
} from "@/lib/ledger-strip";

export { buildDashboardBudgetGroups } from "@/lib/dashboard-budget-groups";

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
    selectedAccountId?: string;
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
    accountId: options.selectedAccountId,
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

export interface DashboardInvestmentSummary {
  total: number;
  dayChange: { amount: number; pct: number } | null;
  topMovers: {
    id: string;
    name: string;
    ticker: string | null;
    changePct: number;
  }[] | null;
  hasHoldings?: boolean;
  hasAccountsWithoutHoldings?: boolean;
}

/**
 * How far back the widget will look for the previous valuation point.
 *
 * The widget needs the two most recent snapshot dates, not the history — and
 * this runs on every dashboard render, which `AutoRefresh` repeats every two
 * minutes. A window keeps the read bounded; a gap wider than this leaves
 * `dayChange` null, which is the honest answer anyway, since a comparison
 * against a months-old valuation is not a day change.
 */
const SNAPSHOT_LOOKBACK_DAYS = 30;

function isoDaysBefore(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

async function latestSnapshotDate(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("holding_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.snapshot_date as string | undefined) ?? null;
}

export async function loadDashboardInvestmentSummary(
  supabase: SupabaseClient,
  userId?: string,
): Promise<DashboardInvestmentSummary> {
  const newest = await latestSnapshotDate(supabase);
  const [holdings, snapshots, investmentAccounts] = await Promise.all([
    loadHoldings(supabase),
    newest
      ? loadHoldingSnapshots(supabase, {
          since: isoDaysBefore(newest, SNAPSHOT_LOOKBACK_DAYS),
        })
      : Promise.resolve([]),
    userId ? loadInvestmentAccounts(supabase, userId) : Promise.resolve([]),
  ]);
  const coverage = buildInvestmentAccountCoverage(investmentAccounts, holdings);
  const latestDates = [...new Set(snapshots.map((row) => row.snapshotDate))]
    .sort((left, right) => right.localeCompare(left))
    .slice(0, 2);
  const latestDateSet = new Set(latestDates);
  const page = buildInvestmentsPage(
    holdings,
    snapshots.filter((row) => latestDateSet.has(row.snapshotDate)),
  );
  const hasHoldings = holdings.some(
    (h) => h.isActive && (h.value !== null || (h.quantity !== null && h.price !== null)),
  );
  const total = coverage.total > 0 ? coverage.total : page.total;
  const result: DashboardInvestmentSummary = {
    total,
    dayChange: page.dayChange,
    topMovers: page.topMovers?.slice(0, 3) ?? null,
  };
  if (total > 0 && !hasHoldings) {
    result.hasHoldings = false;
  }
  if (coverage.accountsWithoutHoldings > 0) {
    result.hasAccountsWithoutHoldings = true;
  }
  return result;
}

export interface OverviewLedgerStrip {
  ticks: LedgerTick[];
  account: LedgerStripAccount | null;
  /** Every account the strip could anchor to, for the account picker. */
  accounts: LedgerStripAccount[];
  currency: string;
}

export async function loadOverviewWidgetData(
  supabase: SupabaseClient,
  options: Readonly<{
    month: string;
    today: string;
    userId: string;
    household: boolean;
    visible: readonly WidgetKey[];
    accounts: readonly LedgerStripAccount[];
    /** The toolbar's dashboard-wide account filter. */
    selectedAccountId?: string;
    /** The ledger widget's own account pick (`?ledgerAccount=`). */
    ledgerAccountId?: string;
  }>,
): Promise<{
  cumulativeSpend: CumulativeSpendView;
  investments: DashboardInvestmentSummary | null;
  ledgerStrip: OverviewLedgerStrip;
}> {
  const anchorableAccounts = listAnchorableAccounts(options.accounts, {
    ownerUserId: options.userId,
    household: options.household,
  });
  // The widget's own pick outranks the toolbar filter, but only while it still
  // resolves to an eligible account. One that no longer does - a bank
  // unlinked, the scope switched back to personal, a hand-edited URL - falls
  // back to the default anchor rather than blanking the strip: `ledgerAccount`
  // has no toolbar control to undo it, so hiding the widget would take the
  // only way back with it. Resolution runs through `listAnchorableAccounts`,
  // so the ownership rule fails closed here exactly as it does for the default.
  const pickedLedgerAccount = options.ledgerAccountId
    ? anchorableAccounts.find((account) => account.id === options.ledgerAccountId)
    : undefined;
  const anchorAccount =
    pickedLedgerAccount ??
    pickAnchorAccount(options.accounts, {
      ownerUserId: options.userId,
      household: options.household,
      selectedAccountId: options.selectedAccountId,
    });
  const [cumulativeSpend, investments, ledgerTicks] = await Promise.all([
    options.visible.includes("spendingCompare")
      ? loadCumulativeSpend(supabase, options)
      : Promise.resolve(EMPTY_CUMULATIVE_SPEND),
    options.visible.includes("investments")
      ? loadDashboardInvestmentSummary(supabase, options.userId)
      : Promise.resolve(null),
    anchorAccount
      ? loadLedgerStripTicks(supabase, {
          accountId: anchorAccount.id,
          month: options.month,
          today: options.today,
          currentBalance: anchorAccount.current_balance!,
        })
      : Promise.resolve([]),
  ]);
  return {
    cumulativeSpend,
    investments,
    ledgerStrip: {
      ticks: ledgerTicks,
      account: anchorAccount,
      accounts: anchorableAccounts,
      currency: anchorAccount?.iso_currency_code ?? "USD",
    },
  };
}
