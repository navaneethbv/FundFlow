import DashboardWidgetGrid, {
  type DashboardWidgetGridData,
} from "@/components/dashboard/DashboardWidgetGrid";
import RecentActivity from "@/components/dashboard/RecentActivity";
import { normalizeWidgetPrefs } from "@/lib/dashboard-widgets";
import { loadCumulativeSpend } from "@/lib/dashboard-widgets-data";
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
  userId,
  household,
  month,
}: Readonly<{
  prefsRaw: unknown;
  data: DashboardWidgetGridData;
  goals: Goal[];
  recent: ComponentProps<typeof RecentActivity>["transactions"];
  accountNames: Map<string, string>;
  userId: string;
  household: boolean;
  month: string;
}>) {
  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();
  const spend = await loadCumulativeSpend(supabase, {
    month,
    today,
    userId,
    household,
  });

  return (
    <>
      <DashboardWidgetGrid
        prefs={normalizeWidgetPrefs(prefsRaw)}
        data={data}
        goals={goals}
        cumulativeSpend={spend.days}
        monthLabel={spend.monthLabel}
        previousMonthLabel={spend.previousMonthLabel}
        recentTransactions={recent}
        accountNames={accountNames}
        today={today}
      />
    </>
  );
}
