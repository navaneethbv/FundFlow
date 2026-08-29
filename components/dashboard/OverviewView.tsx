import DashboardWidgetGrid, {
  type DashboardWidgetGridData,
} from "@/components/dashboard/DashboardWidgetGrid";
import LedgerStrip from "@/components/dashboard/LedgerStrip";
import RecentActivity from "@/components/dashboard/RecentActivity";
import {
  normalizeWidgetPrefs,
  visibleWidgets,
} from "@/lib/dashboard-widgets";
import { loadOverviewWidgetData } from "@/lib/dashboard-widgets-data";
import type { AccountSummary } from "@/lib/dashboard";
import { formatMonth } from "@/lib/format";
import type { Goal } from "@/lib/goals";
import { createClient } from "@/lib/supabase/server";
import type { ComponentProps } from "react";

/**
 * The Phase 8 overview: the customizable widget grid, as a sibling of
 * MonitorView / PlanView / WealthView so `app/dashboard/page.tsx` stays the
 * orchestrator its own test insists on.
 *
 * It owns the one query the grid needs beyond what the page already loaded, so
 * the other three views never pay for it.
 */
export default async function OverviewView({
  prefsRaw,
  data,
  goals,
  recent,
  accountNames,
  accounts,
  userId,
  household,
  month,
  selectedAccountId,
}: Readonly<{
  prefsRaw: unknown;
  data: Omit<DashboardWidgetGridData, "investments">;
  goals: Goal[];
  recent: ComponentProps<typeof RecentActivity>["transactions"];
  accountNames: Map<string, string>;
  accounts: AccountSummary[];
  userId: string;
  household: boolean;
  month: string;
  selectedAccountId?: string;
}>) {
  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();
  const prefs = normalizeWidgetPrefs(prefsRaw);
  const monthLabel = formatMonth(month);
  const loaded = await loadOverviewWidgetData(supabase, {
    month,
    today,
    userId,
    household,
    visible: visibleWidgets(prefs),
    accounts,
    selectedAccountId,
  });

  return (
    <>
      {loaded.ledgerStrip.account && (
        <LedgerStrip
          ticks={loaded.ledgerStrip.ticks}
          accountName={loaded.ledgerStrip.account.name ?? "Account"}
          accountMask={loaded.ledgerStrip.account.mask}
          month={month}
          monthLabel={monthLabel}
          currency={loaded.ledgerStrip.currency}
        />
      )}
      <DashboardWidgetGrid
        prefs={prefs}
        data={{ ...data, investments: loaded.investments }}
        goals={goals}
        cumulativeSpend={loaded.cumulativeSpend.days}
        monthLabel={loaded.cumulativeSpend.monthLabel}
        previousMonthLabel={loaded.cumulativeSpend.previousMonthLabel}
        recentTransactions={recent}
        accountNames={accountNames}
        today={today}
      />
    </>
  );
}
