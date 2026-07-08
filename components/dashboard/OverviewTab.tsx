import type { DashboardData } from "@/lib/dashboard";
import { foldTail } from "@/lib/chart-utils";
import { formatCurrency, formatMonth, titleCase } from "@/lib/format";
import AreaSparkline from "@/components/charts/AreaSparkline";
import DonutChart from "@/components/charts/DonutChart";
import MiniBars from "@/components/charts/MiniBars";
import RadialGauge from "@/components/charts/RadialGauge";
import StatTile from "@/components/charts/StatTile";
import TrendChart from "@/components/charts/TrendChart";
import Panel from "@/components/ui/Panel";
import BarList from "@/components/dashboard/BarList";
import GoalsSummary from "@/components/dashboard/GoalsSummary";
import PlanningInsights from "@/components/dashboard/PlanningInsights";
import PlanningDepth from "@/components/dashboard/PlanningDepth";
import RecentActivity, { type RecentTransaction } from "@/components/dashboard/RecentActivity";
import type { Goal } from "@/lib/goals";

export default function OverviewTab({
  data,
  netWorth,
  savingsRate,
  recentTransactions,
  accountNames,
  goals,
}: {
  data: DashboardData;
  netWorth: number;
  savingsRate: number;
  recentTransactions: RecentTransaction[];
  accountNames: Map<string, string>;
  goals: Goal[];
}) {
  const monthLabels = data.monthlySpending.map((m) => formatMonth(m.month));
  const spendSeries = data.monthlySpending.map((m) => m.amount);
  const incomeSeries = data.monthlyIncome.map((m) => m.amount);
  const cashFlowSeries = spendSeries.map((spend, index) => (incomeSeries[index] ?? 0) - spend);
  const prevMonth = monthLabels[monthLabels.length - 2] ?? "last month";
  const currentNet = data.currentMonthIncome - data.currentMonthExpenses;
  const previousSavings =
    (incomeSeries[incomeSeries.length - 2] ?? 0) - (spendSeries[spendSeries.length - 2] ?? 0);
  const maxMerchant = Math.max(1, ...data.merchantBreakdown.map((m) => m.amount));
  const donutItems = foldTail(
    data.categoryBreakdown.map((c) => ({ label: titleCase(c.category), amount: c.amount })),
    6,
    (amount) => ({ label: "Other", amount }),
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total Net Worth" value={netWorth} delta={currentNet - previousSavings} deltaVs={prevMonth} chart={<AreaSparkline values={cashFlowSeries} />} />
        <StatTile label="Monthly Cash Flow" value={currentNet} delta={currentNet - previousSavings} deltaVs={prevMonth} trend={cashFlowSeries} />
        <StatTile label="Monthly Spending" value={data.currentMonthExpenses} delta={spendSeries[5]! - (spendSeries[4] ?? 0)} deltaVs={prevMonth} upIsGood={false} chart={<MiniBars values={spendSeries} />} />
        <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="eyebrow">Savings Rate</h3>
              <p className="display mt-3 text-3xl">{savingsRate}%</p>
              <p className="mt-2 text-sm font-bold text-success">Based on this month</p>
            </div>
            <RadialGauge value={savingsRate} />
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Spending vs income" eyebrow="Last 6 months">
          <TrendChart
            labels={monthLabels}
            series={[
              { name: "Spending", slot: 1, values: spendSeries },
              { name: "Income", slot: 2, values: incomeSeries },
            ]}
          />
        </Panel>
        <Panel title="Spending by category" eyebrow="This month" action={<span className="text-xs font-bold text-muted">Total {formatCurrency(data.currentMonthExpenses)}</span>}>
          <DonutChart items={donutItems} centerLabel="spent" />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Savings goals" eyebrow="Progress" action={<span className="text-xs font-bold text-muted">Savings rate {savingsRate}%</span>}>
          <GoalsSummary goals={goals} />
        </Panel>
        <Panel title="Recurring streams" eyebrow="Subscriptions and income">
          <div className="space-y-3">
            {data.subscriptions.slice(0, 5).map((stream) => (
              <div key={`${stream.merchant}-${stream.amount}`} className="flex items-center justify-between gap-4 rounded-field p-2 hover:bg-panel-hover">
                <span>
                  <span className="block text-sm font-semibold">{stream.merchant}</span>
                  <span className="block text-xs text-muted">{stream.frequency ?? "Recurring"}</span>
                </span>
                <span className="tabular-nums text-sm font-bold">{formatCurrency(stream.amount)}</span>
              </div>
            ))}
            {data.subscriptions.length === 0 && <p className="py-4 text-sm text-muted">No recurring streams yet.</p>}
          </div>
        </Panel>
      </div>

      <PlanningInsights data={data} />

      <PlanningDepth data={data} goals={goals} />

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Recent activity" className="xl:col-span-1">
          <RecentActivity transactions={recentTransactions} accountNames={accountNames} />
        </Panel>
        <Panel title="Top merchants" className="xl:col-span-1">
          <BarList items={data.merchantBreakdown.map((m) => ({ label: m.merchant, amount: m.amount }))} max={maxMerchant} />
        </Panel>
      </div>
    </div>
  );
}
