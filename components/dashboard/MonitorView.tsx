import Link from "next/link";
import type { DashboardData } from "@/lib/dashboard";
import { foldTail } from "@/lib/chart-utils";
import { medianOf } from "@/lib/insights";
import { dashboardUrl, OTHER_CATEGORY_KEY } from "@/lib/drilldown";
import { formatCurrency, formatDay, formatMonth, titleCase } from "@/lib/format";
import AreaSparkline from "@/components/charts/AreaSparkline";
import DonutChart from "@/components/charts/DonutChart";
import MiniBars from "@/components/charts/MiniBars";
import RadialGauge from "@/components/charts/RadialGauge";
import StatTile from "@/components/charts/StatTile";
import TrendChart from "@/components/charts/TrendChart";
import BarList from "@/components/dashboard/BarList";
import CategoryDrilldownPanel, {
  type DrillLinkParams,
} from "@/components/dashboard/CategoryDrilldownPanel";
import MerchantDrilldownPanel from "@/components/dashboard/MerchantDrilldownPanel";
import RecentActivity, {
  type RecentTransaction,
} from "@/components/dashboard/RecentActivity";
import Panel from "@/components/ui/Panel";

type AttentionItem = {
  label: string;
  detail: string;
  href: string;
  tone: "warning" | "danger";
};

function getAttentionItems(data: DashboardData): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (data.cashFlowForecast.lowBalanceRisk) {
    items.push({
      label: "Cash risk",
      detail: `Balance may fall to ${formatCurrency(data.cashFlowForecast.lowestBalance)} in the next 30 days.`,
      href: "/dashboard?view=plan",
      tone: "danger",
    });
  }

  const riskyBudgets = data.budgetEnvelopes.filter(
    (budget) => budget.status === "over" || budget.status === "at-risk",
  );
  if (riskyBudgets.length > 0) {
    items.push({
      label: "Budget pace",
      detail: `${riskyBudgets.length} budget${riskyBudgets.length === 1 ? "" : "s"} projected to need attention.`,
      href: "/settings#budgets",
      tone: riskyBudgets.some((budget) => budget.status === "over")
        ? "danger"
        : "warning",
    });
  }

  if (data.spendingAnomalies.length > 0) {
    items.push({
      label: "Unusual activity",
      detail: data.spendingAnomalies[0]!.message,
      href: `/review?month=${data.selectedMonth}`,
      tone: data.spendingAnomalies[0]!.severity === "warning" ? "warning" : "danger",
    });
  }

  const recurringIssues = data.recurringStatuses.filter(
    (item) => item.status === "late" || item.status === "unusual_amount",
  );
  if (recurringIssues.length > 0) {
    items.push({
      label: "Recurring payment",
      detail:
        recurringIssues[0]!.reviewPrompt ??
        `${recurringIssues[0]!.name} needs review.`,
      href: "/dashboard?view=plan",
      tone: recurringIssues[0]!.status === "late" ? "danger" : "warning",
    });
  }

  return items;
}

export default function MonitorView({
  data,
  netWorth,
  savingsRate,
  recentTransactions,
  accountNames,
  linkParams,
  drillQuery,
  prefs,
}: {
  data: DashboardData;
  netWorth: number;
  savingsRate: number;
  recentTransactions: RecentTransaction[];
  accountNames: Map<string, string>;
  linkParams: DrillLinkParams;
  drillQuery: { category?: string; sub?: string; merchant?: string };
  prefs?: { hideRecent?: boolean; hideBreakdowns?: boolean };
}) {
  const monthLabels = data.monthlySpending.map((month) => formatMonth(month.month));
  const spendSeries = data.monthlySpending.map((month) => month.amount);
  const incomeSeries = data.monthlyIncome.map((month) => month.amount);
  const cashFlowSeries = spendSeries.map(
    (spend, index) => (incomeSeries[index] ?? 0) - spend,
  );
  const previousMonth = monthLabels[monthLabels.length - 2] ?? "last month";
  const currentNet = data.currentMonthIncome - data.currentMonthExpenses;
  const previousNet =
    (incomeSeries[incomeSeries.length - 2] ?? 0) -
    (spendSeries[spendSeries.length - 2] ?? 0);
  const maxMerchant = Math.max(1, ...data.merchantBreakdown.map((item) => item.amount));
  const merchantItems = data.merchantBreakdown.map((item) => ({
    label: item.merchant,
    amount: item.amount,
    href: dashboardUrl({ ...linkParams, merchant: item.merchant }),
  }));
  const donutItems = foldTail(
    data.categoryBreakdown.map((category) => ({
      label: titleCase(category.category),
      amount: category.amount,
      href: dashboardUrl({ ...linkParams, category: category.category }),
    })),
    6,
    (amount) => ({
      label: "Other",
      amount,
      href: dashboardUrl({ ...linkParams, category: OTHER_CATEGORY_KEY }),
    }),
  );
  const showAllCategories = drillQuery.category === OTHER_CATEGORY_KEY;
  const maxCategory = Math.max(
    1,
    ...data.categoryBreakdown.map((category) => category.amount),
  );
  const drillableMerchants = new Set(data.drillableMerchants);
  const attentionItems = getAttentionItems(data);
  const insights = data.insights;
  const safeToSpend = insights.safeToSpend;
  const paycheck = insights.paycheck;
  const completedEssentials = insights.essentialsSplit
    .slice(0, -1)
    .map((row) => row.essentials)
    .filter((amount) => amount > 0);
  const typicalEssentials = completedEssentials.length
    ? medianOf(completedEssentials)
    : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Net worth"
          value={netWorth}
          delta={currentNet - previousNet}
          deltaVs={previousMonth}
          chart={<AreaSparkline values={cashFlowSeries} />}
        />
        <StatTile
          label="Monthly cash flow"
          value={currentNet}
          delta={currentNet - previousNet}
          deltaVs={previousMonth}
          trend={cashFlowSeries}
        />
        <StatTile
          label="Monthly spending"
          value={data.currentMonthExpenses}
          delta={(spendSeries.at(-1) ?? 0) - (spendSeries.at(-2) ?? 0)}
          deltaVs={previousMonth}
          upIsGood={false}
          chart={<MiniBars values={spendSeries} />}
        />
        <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-muted">Savings rate</h2>
              <p className="metric-value mt-3 text-3xl">{savingsRate}%</p>
              <p className="mt-2 text-xs font-medium text-muted">Based on this month</p>
            </div>
            <RadialGauge value={savingsRate} />
          </div>
        </section>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
          <h3 className="eyebrow">Safe to spend</h3>
          <p className="metric-value mt-3 text-3xl">
            {safeToSpend ? formatCurrency(safeToSpend.amount) : "—"}
          </p>
          <p className="mt-2 text-xs font-medium text-muted">
            {safeToSpend
              ? safeToSpend.anchor === "paycheck"
                ? `After ${formatCurrency(safeToSpend.upcomingBillsTotal)} in bills before your ${formatDay(safeToSpend.horizonEnd)} paycheck`
                : `After ${formatCurrency(safeToSpend.upcomingBillsTotal)} in bills over the next two weeks`
              : "Connect a checking account to see what's spendable."}
          </p>
        </section>
        <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
          <h3 className="eyebrow">Emergency runway</h3>
          <p className="metric-value mt-3 text-3xl">
            {insights.runwayMonths !== null ? `${insights.runwayMonths} mo` : "—"}
          </p>
          <p className="mt-2 text-xs font-medium text-muted">
            {insights.runwayMonths !== null && typicalEssentials !== null
              ? `Cash on hand vs ~${formatCurrency(typicalEssentials)}/mo in essentials`
              : "Needs a full month of essential spending history."}
          </p>
        </section>
        <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
          <h3 className="eyebrow">Next paycheck</h3>
          <p className="metric-value mt-3 text-3xl">
            {paycheck?.nextPayDate ? formatDay(paycheck.nextPayDate) : "—"}
          </p>
          <p className="mt-2 text-xs font-medium text-muted">
            {paycheck?.nextPayDate
              ? `${formatCurrency(paycheck.amount)} expected from ${paycheck.name}`
              : "No recurring income detected yet."}
          </p>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <Panel
          title="Spending versus income"
          eyebrow="Six-month movement"
          className="xl:col-span-8"
        >
          <TrendChart
            labels={monthLabels}
            links={data.monthlySpending.map((month) =>
              dashboardUrl({ ...linkParams, ...drillQuery, month: month.month }),
            )}
            series={[
              { name: "Spending", slot: 6, values: spendSeries },
              { name: "Income", slot: 1, values: incomeSeries },
            ]}
          />
        </Panel>
        <Panel title="Needs attention" className="xl:col-span-4">
          {attentionItems.length === 0 ? (
            <div className="rounded-field border border-success/20 bg-success/[0.06] p-4">
              <p className="text-sm font-semibold text-success">
                Nothing needs attention right now.
              </p>
              <p className="mt-1 text-xs text-muted">
                Bank health, cash outlook, budgets, and recurring activity look stable.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {attentionItems.slice(0, 4).map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="block rounded-field border border-panel-border bg-panel-2 p-3 transition-colors hover:bg-panel-hover focus-visible:outline-2"
                >
                  <span
                    className={
                      item.tone === "danger"
                        ? "text-xs font-bold text-danger"
                        : "text-xs font-bold text-warning"
                    }
                  >
                    {item.label}
                  </span>
                  <span className="mt-1 block text-sm text-muted">{item.detail}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {!prefs?.hideRecent && (recentTransactions.length > 0 || merchantItems.length > 0) && (
        <div className="grid gap-5 xl:grid-cols-12">
          {recentTransactions.length > 0 && (
            <Panel title="Recent activity" className="xl:col-span-8">
              <RecentActivity
                transactions={recentTransactions}
                accountNames={accountNames}
              />
            </Panel>
          )}
          {merchantItems.length > 0 && (
            <Panel title="Top merchants" className="xl:col-span-4">
              <BarList items={merchantItems.slice(0, 6)} max={maxMerchant} />
            </Panel>
          )}
        </div>
      )}

      {!prefs?.hideBreakdowns && (donutItems.length > 0 || data.subscriptions.length > 0) && (
        <div className="grid gap-5 xl:grid-cols-12">
          {data.drilldown?.kind === "category" ? (
            <div className="xl:col-span-7">
              <CategoryDrilldownPanel
                drill={data.drilldown}
                linkParams={linkParams}
                month={data.selectedMonth}
              />
            </div>
          ) : data.drilldown?.kind === "merchant" ? (
            <div className="xl:col-span-7">
              <MerchantDrilldownPanel
                drill={data.drilldown}
                linkParams={linkParams}
                month={data.selectedMonth}
              />
            </div>
          ) : showAllCategories ? (
            <Panel
              title="All categories"
              className="xl:col-span-7"
              action={
                <Link
                  href={dashboardUrl(linkParams)}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Back to top 6
                </Link>
              }
            >
              <BarList
                items={data.categoryBreakdown.map((category) => ({
                  label: titleCase(category.category),
                  amount: category.amount,
                  href: dashboardUrl({
                    ...linkParams,
                    category: category.category,
                  }),
                }))}
                max={maxCategory}
              />
            </Panel>
          ) : donutItems.length > 0 ? (
            <Panel title="Spending by category" className="xl:col-span-7">
              <DonutChart items={donutItems} centerLabel="spent" />
            </Panel>
          ) : null}
          {data.subscriptions.length > 0 && (
            <Panel title="Recurring streams" className="xl:col-span-5">
              <div className="divide-y divide-panel-border">
                {data.subscriptions.slice(0, 6).map((stream) => {
                  const body = (
                    <>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {stream.merchant}
                        </span>
                        <span className="block text-xs text-muted">
                          {stream.frequency ?? "Recurring"}
                        </span>
                      </span>
                      <span className="metric-value text-sm">
                        {formatCurrency(stream.amount)}
                      </span>
                    </>
                  );
                  const className =
                    "flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0";

                  return drillableMerchants.has(
                    stream.merchant.trim().toLowerCase(),
                  ) ? (
                    <Link
                      key={`${stream.merchant}-${stream.amount}`}
                      href={dashboardUrl({
                        ...linkParams,
                        merchant: stream.merchant,
                      })}
                      className={`${className} rounded-field hover:bg-panel-hover focus-visible:outline-2`}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div
                      key={`${stream.merchant}-${stream.amount}`}
                      className={className}
                    >
                      {body}
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
