import type { ComponentProps } from "react";
import BudgetWidget from "@/components/dashboard/widgets/BudgetWidget";
import GoalsWidget from "@/components/dashboard/widgets/GoalsWidget";
import InvestmentsWidget from "@/components/dashboard/widgets/InvestmentsWidget";
import NetWorthWidget from "@/components/dashboard/widgets/NetWorthWidget";
import RecurringWidget, {
  type UpcomingRecurringItem,
} from "@/components/dashboard/widgets/RecurringWidget";
import SpendingCompareWidget from "@/components/dashboard/widgets/SpendingCompareWidget";
import TransactionsWidget from "@/components/dashboard/widgets/TransactionsWidget";
import RecentActivity from "@/components/dashboard/RecentActivity";
import {
  visibleWidgets,
  WIDGET_DEFINITIONS,
  type DashboardWidgetPrefs,
  type WidgetKey,
} from "@/lib/dashboard-widgets";
import type { CumulativeSpendDay } from "@/lib/dashboard";
import type { Goal } from "@/lib/goals";
import type { DashboardBudgetGroup } from "@/lib/dashboard-budget-groups";
import type { DashboardInvestmentSummary } from "@/lib/dashboard-widgets-data";

/**
 * The customizable widget grid (Phase 8).
 *
 * Every widget is a thin server component over data the page already loaded,
 * so the grid adds no queries of its own beyond the cumulative-spend window.
 * Widgets render in Monarch's fixed asymmetric two-column split (left:
 * Budget/Net worth/Goals; right: Spending/Transactions/Recurring/
 * Investments — see `WidgetDefinition.column`); the user's saved `order`
 * still controls arrangement within whichever column a widget belongs to.
 */

export interface DashboardWidgetGridData {
  budgetGroups: DashboardBudgetGroup[];
  netWorthHistory: { month: string; netWorth: number }[];
  recurringStatuses: UpcomingRecurringItem[];
  investments: DashboardInvestmentSummary | null;
}

export default function DashboardWidgetGrid({
  prefs,
  data,
  goals,
  cumulativeSpend,
  monthLabel,
  previousMonthLabel,
  recentTransactions,
  accountNames,
  today,
  currency = "USD",
}: Readonly<{
  prefs: DashboardWidgetPrefs;
  data: DashboardWidgetGridData;
  goals: Goal[];
  cumulativeSpend: CumulativeSpendDay[];
  monthLabel: string;
  previousMonthLabel: string;
  recentTransactions: ComponentProps<typeof RecentActivity>["transactions"];
  accountNames: Map<string, string>;
  today: string;
  currency?: string;
}>) {
  const keys = visibleWidgets(prefs);

  if (keys.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        Every widget is hidden. Use Customize to bring some back.
      </p>
    );
  }

  const render = (key: WidgetKey) => {
    switch (key) {
      case "budget":
        return (
          <BudgetWidget groups={data.budgetGroups} currency={currency} />
        );
      case "spendingCompare":
        return (
          <SpendingCompareWidget
            days={cumulativeSpend}
            monthLabel={monthLabel}
            previousMonthLabel={previousMonthLabel}
            currency={currency}
          />
        );
      case "netWorth":
        return (
          <NetWorthWidget history={data.netWorthHistory} currency={currency} />
        );
      case "transactions":
        return (
          <TransactionsWidget
            transactions={recentTransactions}
            accountNames={accountNames}
          />
        );
      case "recurring":
        return (
          <RecurringWidget
            items={data.recurringStatuses}
            today={today}
            currency={currency}
          />
        );
      case "goals":
        return <GoalsWidget goals={goals} />;
      case "investments":
        return <InvestmentsWidget currency={currency} summary={data.investments} />;
    }
  };

  const left = keys.filter((key) => WIDGET_DEFINITIONS[key].column === "left");
  const right = keys.filter((key) => WIDGET_DEFINITIONS[key].column === "right");

  const column = (side: WidgetKey[], name: string) => (
    <div data-dashboard-column={name} className="min-w-0 space-y-5">
      {side.map((key) => (
        // min-w-0: a grid item defaults to min-width:auto, so a widget with a
        // wide child (table, chart, long merchant name) stretches its track
        // instead of scrolling inside itself, and takes the whole page into
        // horizontal overflow on a phone.
        <div key={key} className="min-w-0">
          {render(key)}
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[6fr_5fr] lg:items-start">
      {column(left, "left")}
      {column(right, "right")}
    </div>
  );
}
