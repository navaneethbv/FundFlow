import Link from "next/link";
import type { DashboardData } from "@/lib/dashboard";
import type { BillGrouping } from "@/lib/planning";
import type { Goal } from "@/lib/goals";
import { dashboardUrl } from "@/lib/drilldown";
import { formatCurrency, titleCase } from "@/lib/format";
import Badge from "@/components/ui/Badge";
import Panel from "@/components/ui/Panel";
import BillCalendar from "@/components/dashboard/BillCalendar";
import GoalsSummary from "@/components/dashboard/GoalsSummary";
import PlanningDepth from "@/components/dashboard/PlanningDepth";
import WhatIfPanel from "@/components/dashboard/WhatIfPanel";
import { medianOf, projectNetWorth } from "@/lib/insights";

type PlanData = Pick<
  DashboardData,
  "budgetEnvelopes" | "recurringWeeks" | "recurringStatuses"
>;

export type PlanSetupItem = {
  label: string;
  href: string;
};

export function getPlanSetupItems(
  data: PlanData,
  goals: Goal[],
): PlanSetupItem[] {
  const items: PlanSetupItem[] = [];
  if (data.budgetEnvelopes.length === 0) {
    items.push({
      label: "Create a monthly budget",
      href: "/settings#budgets",
    });
  }
  if (goals.length === 0) {
    items.push({ label: "Add a savings goal", href: "/goals" });
  }
  if (
    data.recurringWeeks.length === 0 &&
    data.recurringStatuses.length === 0
  ) {
    items.push({
      label: "Refresh recurring transactions",
      href: "/settings",
    });
  }
  return items;
}

function budgetTone(status: string): "success" | "warning" | "danger" {
  if (status === "over") return "danger";
  if (status === "at-risk") return "warning";
  return "success";
}

function recurringTone(
  status: string,
): "success" | "warning" | "danger" | "accent" {
  if (status === "paid") return "success";
  if (status === "unusual_amount") return "warning";
  if (status === "late") return "danger";
  return "accent";
}

export default function PlanView({
  data,
  goals,
  billsGrouping = "weekly",
  billsLinkParams = {},
  prefs,
}: {
  data: DashboardData;
  goals: Goal[];
  billsGrouping?: BillGrouping;
  billsLinkParams?: { month?: string; accountId?: string; itemId?: string };
  prefs?: { hideBillCalendar?: boolean; hideWhatIf?: boolean; hideDebt?: boolean };
}) {
  const setupItems = getPlanSetupItems(data, goals);
  const billPeriods = data.billPeriods[billsGrouping];
  const priceDrift = data.insights.priceDrift;
  const debt = data.insights.debt;
  const sinking = data.insights.sinkingFunds;

  // Net-worth trajectory: median completed-month net (income − spend), 0%
  // growth assumption stated in the panel.
  const netSeries = data.monthlySpending.map(
    (month, index) => (data.monthlyIncome[index]?.amount ?? 0) - month.amount,
  );
  const completedNet = netSeries.slice(0, -1);
  const monthlySavings = completedNet.length > 0 ? medianOf(completedNet) : 0;
  const projectedYear1 =
    projectNetWorth({
      currentNetWorth: data.netWorthSnapshot.netWorth,
      monthlySavings,
      months: 12,
    }).at(-1)?.netWorth ?? data.netWorthSnapshot.netWorth;
  const projectedYear5 =
    projectNetWorth({
      currentNetWorth: data.netWorthSnapshot.netWorth,
      monthlySavings,
      months: 60,
    }).at(-1)?.netWorth ?? data.netWorthSnapshot.netWorth;

  const whatIfDebts = data.accounts
    .filter((account) => account.type === "credit" && Number(account.current_balance ?? 0) > 0)
    .map((account) => ({
      name: account.name ?? "Card",
      balance: Number(account.current_balance),
      apr: account.apr === null || account.apr === undefined ? 22 : Number(account.apr),
    }));

  return (
    <div className="space-y-5">
      {setupItems.length > 0 && (
        <Panel title="Set up your plan" tone="accent">
          <p className="mb-3 text-sm text-muted">
            Add the missing details below to unlock a more complete monthly plan.
          </p>
          <div className="flex flex-wrap gap-2">
            {setupItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-field border border-accent/25 bg-panel px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent-soft focus-visible:outline-2"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-5 xl:grid-cols-12">
        {data.budgetEnvelopes.length > 0 && (
          <Panel
            title="Budget pace"
            eyebrow="Month-end projection"
            className="xl:col-span-7"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {data.budgetEnvelopes.slice(0, 6).map((budget) => {
                const progress = Math.min(
                  100,
                  (budget.spent / Math.max(1, budget.monthlyLimit)) * 100,
                );
                return (
                  <div
                    key={budget.category}
                    className="rounded-field border border-panel-border bg-panel-2 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">
                        {titleCase(budget.category)}
                      </span>
                      <Badge tone={budgetTone(budget.status)}>{budget.status}</Badge>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel-hover">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="mt-2 flex justify-between gap-3 text-xs text-muted">
                      <span>{formatCurrency(budget.remaining)} left</span>
                      <span>{formatCurrency(budget.projectedSpend)} projected</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <Link
              href="/settings#budgets"
              className="mt-4 inline-block text-xs font-semibold text-accent hover:underline"
            >
              Manage budgets
            </Link>
          </Panel>
        )}

        {goals.length > 0 && (
          <Panel
            title="Savings goals"
            eyebrow="Funding progress"
            className={data.budgetEnvelopes.length > 0 ? "xl:col-span-5" : "xl:col-span-12"}
          >
            <GoalsSummary goals={goals} />
          </Panel>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <Panel
          title="Cash forecast"
          eyebrow="Next 30 days"
          tone={data.cashFlowForecast.lowBalanceRisk ? "warning" : "success"}
          className="xl:col-span-5"
        >
          <p className="metric-value text-3xl">
            {formatCurrency(data.cashFlowForecast.projectedBalance)}
          </p>
          <p className="mt-2 text-sm text-muted">
            Lowest projected balance: {formatCurrency(data.cashFlowForecast.lowestBalance)}
          </p>
          <ul className="mt-4 space-y-2 text-xs text-muted">
            {data.cashFlowForecast.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </Panel>

        {!prefs?.hideBillCalendar && (
          <div className="xl:col-span-7">
            <BillCalendar
              periods={billPeriods}
              grouping={billsGrouping}
              weeklyHref={dashboardUrl({ view: "plan", ...billsLinkParams, bills: "weekly" })}
              monthlyHref={dashboardUrl({ view: "plan", ...billsLinkParams, bills: "monthly" })}
            />
          </div>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        {!prefs?.hideDebt && debt && (debt.plan || debt.planWithExtra) && (
          <Panel
            title="Debt payoff"
            eyebrow="Avalanche strategy"
            className="xl:col-span-7"
          >
            {debt.plan ? (
              <>
                <p className="text-sm">
                  At minimum payments you are debt-free in{" "}
                  <span className="font-bold">{debt.plan.months} months</span>{" "}
                  paying{" "}
                  <span className="metric-value">{formatCurrency(debt.plan.totalInterest)}</span>{" "}
                  in interest.
                </p>
                {debt.planWithExtra && (
                  <p className="mt-2 text-sm">
                    Adding {formatCurrency(debt.extraMonthly)}/mo:{" "}
                    <span className="font-bold">{debt.planWithExtra.months} months</span>{" "}
                    and{" "}
                    <span className="metric-value">
                      {formatCurrency(debt.planWithExtra.totalInterest)}
                    </span>{" "}
                    in interest — saving{" "}
                    <span className="font-bold text-success">
                      {formatCurrency(
                        Math.max(0, debt.plan.totalInterest - debt.planWithExtra.totalInterest),
                      )}
                    </span>
                    .
                  </p>
                )}
                <ul className="mt-3 space-y-1 text-xs text-muted">
                  {debt.plan.debts.map((d) => (
                    <li key={d.name}>
                      {d.name}: cleared month {d.payoffMonth} ·{" "}
                      {formatCurrency(d.interestPaid)} interest
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-warning">
                Minimum payments don&apos;t cover the interest on these balances —
                the plan never converges. Increase payments to see a payoff date.
              </p>
            )}
            {debt.usesAssumedApr && (
              <p className="mt-3 text-xs text-muted">
                Assumes {`22%`} APR on cards without a rate — set real APRs in
                Settings for accuracy.
              </p>
            )}
          </Panel>
        )}

        {priceDrift.items.length > 0 && (
          <Panel
            title="Price drift"
            eyebrow="Your personal inflation"
            className={debt && (debt.plan || debt.planWithExtra) ? "xl:col-span-5" : "xl:col-span-7"}
          >
            {priceDrift.overallDriftPct !== null && (
              <p className="mb-3 text-sm">
                Repeat merchants cost{" "}
                <span
                  className="font-bold"
                  style={{
                    color:
                      priceDrift.overallDriftPct > 0 ? "var(--viz-bad)" : "var(--viz-good)",
                  }}
                >
                  {priceDrift.overallDriftPct > 0 ? "+" : ""}
                  {priceDrift.overallDriftPct}%
                </span>{" "}
                vs three months ago.
              </p>
            )}
            <ul className="space-y-2 text-sm">
              {priceDrift.items.slice(0, 5).map((item) => (
                <li key={item.merchant} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-semibold">{item.merchant}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {formatCurrency(item.earlierAvg)} → {formatCurrency(item.recentAvg)}{" "}
                    <span
                      className="font-bold"
                      style={{ color: item.driftPct > 0 ? "var(--viz-bad)" : "var(--viz-good)" }}
                    >
                      ({item.driftPct > 0 ? "+" : ""}
                      {item.driftPct}%)
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        {!prefs?.hideWhatIf && (
        <div className="xl:col-span-7">
          <WhatIfPanel
            cashBalance={data.insights.safeToSpend?.cashBalance ?? null}
            monthlyIncome={data.currentMonthIncome}
            monthlySpend={data.currentMonthExpenses}
            monthlyEssentials={data.insights.essentialsSplit
              .slice(0, -1)
              .map((row) => row.essentials)}
            debts={whatIfDebts}
          />
        </div>
        )}
        <div className="space-y-5 xl:col-span-5">
          {sinking.items.length > 0 && (
            <Panel title="Sinking funds" eyebrow="Planned irregulars">
              <p className="mb-3 text-sm">
                Reserve{" "}
                <span className="metric-value">
                  {formatCurrency(sinking.totalMonthlySetAside)}
                </span>
                /mo for what&apos;s coming.
              </p>
              <ul className="space-y-1.5 text-sm">
                {sinking.items.slice(0, 5).map((fund) => (
                  <li key={fund.name} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {fund.name}
                      {fund.dueSoon && (
                        <span className="ml-1.5 text-xs font-bold text-warning">due soon</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {formatCurrency(fund.monthlySetAside)}/mo → {fund.dueDate}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Trajectory" eyebrow="At your current pace">
            <p className="text-sm">
              Saving about{" "}
              <span className="metric-value">{formatCurrency(monthlySavings)}</span>
              /mo, you&apos;re on track for{" "}
              <span className="metric-value">{formatCurrency(projectedYear1)}</span>{" "}
              in a year and{" "}
              <span className="metric-value">{formatCurrency(projectedYear5)}</span>{" "}
              in five.
            </p>
            <p className="mt-2 text-xs text-muted">
              Median of your completed months; assumes 0% investment growth.
              The full balance sheet lives on the Wealth view.
            </p>
          </Panel>
        </div>
      </div>

      {data.recurringStatuses.length > 0 && (
        <Panel title="Recurring status" eyebrow="Paid versus expected">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.recurringStatuses.slice(0, 6).map((item) => (
              <div
                key={item.name}
                className="rounded-field border border-panel-border bg-panel-2 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold">{item.name}</span>
                  <Badge tone={recurringTone(item.status)}>
                    {item.status.replace("_", " ")}
                  </Badge>
                </div>
                {item.reviewPrompt && (
                  <p className="mt-2 text-xs text-muted">{item.reviewPrompt}</p>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <PlanningDepth data={data} goals={goals} />
    </div>
  );
}
