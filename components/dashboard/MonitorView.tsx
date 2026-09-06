import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardData } from "@/lib/dashboard";
import { foldTail } from "@/lib/chart-utils";
import { medianOf } from "@/lib/insights";
import { dashboardUrl, OTHER_CATEGORY_KEY } from "@/lib/drilldown";
import {
  hasSmallSavingsRateBase,
  netWorthDeltaFromHistory,
} from "@/components/dashboard/metrics";
import {
  formatCurrency,
  formatDay,
  formatFrequency,
  formatMonth,
  titleCase,
} from "@/lib/format";
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
import Money from "@/components/ui/Money";
import Panel from "@/components/ui/Panel";

type AttentionItem = {
  label: string;
  detail: string;
  href: string;
  tone: "warning" | "danger";
  /**
   * True when `detail` quotes an amount. The detail is a prebuilt sentence, so
   * the privacy blur has to cover the whole line rather than just the figure —
   * the label still identifies the item while amounts are hidden.
   */
  hasAmount?: boolean;
};

function getAttentionItems(data: DashboardData): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (data.cashFlowForecast.lowBalanceRisk) {
    items.push({
      label: "Cash risk",
      detail: `Balance may fall to ${formatCurrency(data.cashFlowForecast.lowestBalance)} in the next 30 days.`,
      href: "/dashboard?view=plan",
      tone: "danger",
      hasAmount: true,
    });
  }

  const riskyBudgets = data.budgetEnvelopes.filter(
    (budget) => budget.status === "over" || budget.status === "at-risk",
  );
  if (riskyBudgets.length > 0) {
    items.push({
      label: "Budget pace",
      detail: `${riskyBudgets.length} budget${riskyBudgets.length === 1 ? "" : "s"} projected to need attention.`,
      href: "/settings?section=categories",
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
      // `info` is the category-spike severity (lib/planning.ts): a mild
      // signal, not an urgent one, so it reads as a warning rather than being
      // collapsed into the danger bucket with the real flags.
      tone: data.spendingAnomalies[0]!.severity === "info" ? "warning" : "danger",
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
      // An unusual-amount prompt quotes the charge that tripped it.
      hasAmount: recurringIssues[0]!.status === "unusual_amount",
    });
  }

  return items;
}

// Recent activity is the primary monitoring section and stays ahead of detail panels.
function BreakdownPanel({
  data,
  linkParams,
  showAllCategories,
  donutItems,
  maxCategory,
}: Readonly<{
  data: DashboardData;
  linkParams: DrillLinkParams;
  showAllCategories: boolean;
  donutItems: Array<{ label: string; amount: number; href: string }>;
  maxCategory: number;
}>) {
  if (data.drilldown?.kind === "category") {
    return (
      <div className="xl:col-span-7">
        <CategoryDrilldownPanel
          drill={data.drilldown}
          linkParams={linkParams}
          month={data.selectedMonth}
        />
      </div>
    );
  }
  if (data.drilldown?.kind === "merchant") {
    return (
      <div className="xl:col-span-7">
        <MerchantDrilldownPanel
          drill={data.drilldown}
          linkParams={linkParams}
          month={data.selectedMonth}
        />
      </div>
    );
  }
  if (showAllCategories) {
    return (
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
            href: dashboardUrl({ ...linkParams, category: category.category }),
          }))}
          max={maxCategory}
        />
      </Panel>
    );
  }
  if (donutItems.length > 0) {
    return (
      <Panel title="Spending by category" className="xl:col-span-7">
        <DonutChart items={donutItems} centerLabel="spent" />
      </Panel>
    );
  }
  return null;
}

function formatSavingsRatePeriod(
  month: string | null,
  usesPriorCompleteMonth: boolean,
): string | null {
  if (!month) return null;
  const label = formatMonth(month);
  if (usesPriorCompleteMonth) return `${label} (last complete month)`;
  return label;
}

function SavingsRateCard({
  rate,
  income,
  spending,
  month,
  usesPriorCompleteMonth,
}: Readonly<{
  rate: number | null;
  income: number;
  spending: number;
  month: string | null;
  usesPriorCompleteMonth: boolean;
}>) {
  const hasSmallBase = hasSmallSavingsRateBase(income, spending);
  const period = formatSavingsRatePeriod(month, usesPriorCompleteMonth);
  let title: string | undefined;
  if (hasSmallBase && rate !== null) {
    title = `Calculated from ${formatCurrency(income)} of recorded income and ${formatCurrency(spending)} of spending in ${period ?? "the selected period"}.`;
  }

  let detail: ReactNode;
  if (rate === null) {
    detail = period
      ? `No income recorded for ${period}`
      : "Awaiting a complete month of data";
  } else if (hasSmallBase) {
    detail = (
      <>
        <Money amount={income} /> income and <Money amount={spending} /> spending
        recorded in {period ?? "the selected period"}; the rate is highly sensitive
        to income timing.
      </>
    );
  } else if (period) {
    detail = `Based on recorded income from ${period}`;
  } else {
    detail = "Awaiting a complete month of data";
  }

  let displayRate = "N/A";
  if (rate !== null) displayRate = `${rate}%`;

  return (
    <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
      <div className="flex h-11 items-start justify-between gap-2">
        <h3 className="eyebrow">Savings rate</h3>
        <RadialGauge value={rate ?? 0} />
      </div>
      <p
        className={`metric-value mt-3 text-3xl${hasSmallBase ? " text-warning" : ""}`}
        title={title}
      >
        {displayRate}
      </p>
      <p className={`mt-2 text-xs font-medium${hasSmallBase ? " text-warning" : " text-muted"}`}>
        {detail}
      </p>
    </section>
  );
}

function MonitorMetricTiles({
  netWorth,
  netWorthDelta,
  previousMonth,
  currentNet,
  previousNet,
  spendAmount,
  spendDelta,
  spendSeries,
  cashFlowSeries,
  savingsRate,
  savingsRateIncome,
  savingsRateSpending,
  savingsRateMonth,
  savingsRateUsesPriorCompleteMonth,
}: Readonly<{
  netWorth: number;
  netWorthDelta: number | undefined;
  previousMonth: string;
  currentNet: number;
  previousNet: number;
  spendAmount: number;
  spendDelta: number;
  spendSeries: number[];
  cashFlowSeries: number[];
  savingsRate: number | null;
  savingsRateIncome: number;
  savingsRateSpending: number;
  savingsRateMonth: string | null;
  savingsRateUsesPriorCompleteMonth: boolean;
}>) {
  const periodLabel = savingsRateUsesPriorCompleteMonth
    ? "Month-to-date"
    : "Monthly";

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Net worth"
        value={netWorth}
        delta={netWorthDelta}
        deltaVs={previousMonth}
        chart={<AreaSparkline values={cashFlowSeries} />}
      />
      <StatTile
        label={`${periodLabel} cash flow`}
        value={currentNet}
        delta={currentNet - previousNet}
        deltaVs={previousMonth}
        trend={cashFlowSeries}
      />
      <StatTile
        label={`${periodLabel} spending`}
        value={spendAmount}
        delta={spendDelta}
        deltaVs={previousMonth}
        upIsGood={false}
        chart={<MiniBars values={spendSeries} />}
      />
      <SavingsRateCard
        rate={savingsRate}
        income={savingsRateIncome}
        spending={savingsRateSpending}
        month={savingsRateMonth}
        usesPriorCompleteMonth={savingsRateUsesPriorCompleteMonth}
      />
    </div>
  );
}

type MonitorInsights = DashboardData["insights"];

function medianOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return medianOf(values);
}

function SafeToSpendTile({
  safeToSpend,
}: Readonly<Pick<MonitorInsights, "safeToSpend">>) {
  let description: ReactNode;
  if (!safeToSpend) {
    description = "Connect a checking account to see what's spendable.";
  } else if (safeToSpend.anchor === "paycheck") {
    description = (
      <>
        After <Money amount={safeToSpend.upcomingBillsTotal} /> in bills before
        your {formatDay(safeToSpend.horizonEnd)} paycheck
      </>
    );
  } else {
    description = (
      <>
        After <Money amount={safeToSpend.upcomingBillsTotal} /> in bills over the
        next two weeks
      </>
    );
  }

  let value = "\u2014";
  if (safeToSpend) value = formatCurrency(safeToSpend.amount);

  return (
    <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
      <h3 className="eyebrow">Safe to spend</h3>
      <p className="metric-value mt-3 text-3xl">{value}</p>
      <p className="mt-2 text-xs font-medium text-muted">{description}</p>
    </section>
  );
}

function RunwayTile({
  runwayMonths,
  typicalEssentials,
}: Readonly<{
  runwayMonths: MonitorInsights["runwayMonths"];
  typicalEssentials: number | null;
}>) {
  let description: ReactNode;
  if (runwayMonths !== null && typicalEssentials !== null) {
    description = (
      <>
        Cash on hand vs ~<Money amount={typicalEssentials} />{" "}/mo in essentials
      </>
    );
  } else {
    description = "Needs a full month of essential spending history.";
  }

  let value = "\u2014";
  if (runwayMonths !== null) value = `${runwayMonths} mo`;

  return (
    <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
      <h3 className="eyebrow">Emergency runway</h3>
      <p className="metric-value mt-3 text-3xl">{value}</p>
      <p className="mt-2 text-xs font-medium text-muted">{description}</p>
    </section>
  );
}

function PaycheckTile({
  paycheck,
}: Readonly<Pick<MonitorInsights, "paycheck">>) {
  let value = "\u2014";
  let description: ReactNode = "No recurring income detected yet.";
  if (paycheck?.nextPayDate) {
    value = formatDay(paycheck.nextPayDate);
    description = (
      <>
        <Money amount={paycheck.amount} /> expected from {paycheck.name}
      </>
    );
  }

  return (
    <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
      <h3 className="eyebrow">Next paycheck</h3>
      <p className="metric-value mt-3 text-3xl">{value}</p>
      <p className="mt-2 text-xs font-medium text-muted">{description}</p>
    </section>
  );
}

function MonitorPlanningTiles({
  insights,
}: Readonly<{ insights: MonitorInsights }>) {
  const completedEssentials = insights.essentialsSplit
    .slice(0, -1)
    .map((row) => row.essentials)
    .filter((amount) => amount > 0);
  const typicalEssentials = medianOrNull(completedEssentials);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <SafeToSpendTile safeToSpend={insights.safeToSpend} />
      <RunwayTile
        runwayMonths={insights.runwayMonths}
        typicalEssentials={typicalEssentials}
      />
      <PaycheckTile paycheck={insights.paycheck} />
    </div>
  );
}

function attentionToneClass(tone: AttentionItem["tone"]): string {
  if (tone === "danger") return "text-xs font-bold text-danger";
  return "text-xs font-bold text-warning";
}

function AttentionPanel({
  items,
}: Readonly<{ items: AttentionItem[] }>) {
  let content: ReactNode;
  if (items.length === 0) {
    content = (
      <div className="rounded-field border border-success/20 bg-success/[0.06] p-4">
        <p className="text-sm font-semibold text-success">
          Nothing needs attention right now.
        </p>
        <p className="mt-1 text-xs text-muted">
          Bank health, cash outlook, budgets, and recurring activity look stable.
        </p>
      </div>
    );
  } else {
    content = (
      <div className="space-y-2">
        {items.slice(0, 4).map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="block rounded-field border border-panel-border bg-panel-2 p-3 transition-colors hover:bg-panel-hover focus-visible:outline-2"
          >
            <span className={attentionToneClass(item.tone)}>{item.label}</span>
            <span
              data-money={item.hasAmount || undefined}
              className="mt-1 block text-sm text-muted"
            >
              {item.detail}
            </span>
          </Link>
        ))}
      </div>
    );
  }

  return <Panel title="Needs attention" className="xl:col-span-4">{content}</Panel>;
}

function MonitorTrendAndAttention({
  monthLabels,
  monthLinks,
  spendSeries,
  incomeSeries,
  attentionItems,
}: Readonly<{
  monthLabels: string[];
  monthLinks: string[];
  spendSeries: number[];
  incomeSeries: number[];
  attentionItems: AttentionItem[];
}>) {
  return (
    <div className="grid gap-5 xl:grid-cols-12">
      <Panel
        title="Spending versus income"
        eyebrow="Six-month movement"
        className="xl:col-span-8"
      >
        <TrendChart
          labels={monthLabels}
          links={monthLinks}
          series={[
            { name: "Spending", slot: 6, values: spendSeries },
            { name: "Income", slot: 1, values: incomeSeries },
          ]}
        />
      </Panel>
      <AttentionPanel items={attentionItems} />
    </div>
  );
}

function RecentActivitySection({
  hidden,
  transactions,
  merchantItems,
  accountNames,
  maxMerchant,
}: Readonly<{
  hidden: boolean;
  transactions: RecentTransaction[];
  merchantItems: Array<{ label: string; amount: number; href: string }>;
  accountNames: Map<string, string>;
  maxMerchant: number;
}>) {
  if (hidden || (transactions.length === 0 && merchantItems.length === 0)) {
    return null;
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-12">
      {transactions.length > 0 && (
        <Panel title="Recent activity" className="xl:col-span-8">
          <RecentActivity
            transactions={transactions}
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
  );
}

type SubscriptionItem = DashboardData["subscriptions"][number];

function RecurringStreamBody({
  stream,
}: Readonly<{ stream: SubscriptionItem }>) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-tight">
          {stream.merchant}
        </span>
        <span className="mt-0.5 block text-xs text-muted">
          {formatFrequency(stream.frequency)}
        </span>
      </span>
      <span className="metric-value shrink-0 whitespace-nowrap text-sm">
        {formatCurrency(stream.amount)}
      </span>
    </>
  );
}

function RecurringStreamItem({
  stream,
  drillableMerchants,
  linkParams,
}: Readonly<{
  stream: SubscriptionItem;
  drillableMerchants: ReadonlySet<string>;
  linkParams: DrillLinkParams;
}>) {
  const className =
    "flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0";
  const isDrillable = drillableMerchants.has(stream.merchant.trim().toLowerCase());

  if (isDrillable) {
    return (
      <Link
        key={`${stream.merchant}-${stream.amount}`}
        href={dashboardUrl({ ...linkParams, merchant: stream.merchant })}
        className={`${className} rounded-field hover:bg-panel-hover focus-visible:outline-2`}
      >
        <RecurringStreamBody stream={stream} />
      </Link>
    );
  }

  return (
    <div key={`${stream.merchant}-${stream.amount}`} className={className}>
      <RecurringStreamBody stream={stream} />
    </div>
  );
}

function RecurringStreamsPanel({
  subscriptions,
  drillableMerchants,
  linkParams,
}: Readonly<{
  subscriptions: DashboardData["subscriptions"];
  drillableMerchants: ReadonlySet<string>;
  linkParams: DrillLinkParams;
}>) {
  if (subscriptions.length === 0) return null;

  return (
    <Panel title="Recurring streams" className="xl:col-span-5">
      <div className="divide-y divide-panel-border">
        {subscriptions
          .slice(0, 6)
          .map((stream) => (
            <RecurringStreamItem
              key={`${stream.merchant}-${stream.amount}`}
              stream={stream}
              drillableMerchants={drillableMerchants}
              linkParams={linkParams}
            />
          ))}
      </div>
    </Panel>
  );
}

function MonitorBreakdowns({
  hidden,
  data,
  linkParams,
  showAllCategories,
  donutItems,
  maxCategory,
  drillableMerchants,
}: Readonly<{
  hidden: boolean;
  data: DashboardData;
  linkParams: DrillLinkParams;
  showAllCategories: boolean;
  donutItems: Array<{ label: string; amount: number; href: string }>;
  maxCategory: number;
  drillableMerchants: ReadonlySet<string>;
}>) {
  if (hidden || (donutItems.length === 0 && data.subscriptions.length === 0)) {
    return null;
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-12">
      <BreakdownPanel
        data={data}
        linkParams={linkParams}
        showAllCategories={showAllCategories}
        donutItems={donutItems}
        maxCategory={maxCategory}
      />
      <RecurringStreamsPanel
        subscriptions={data.subscriptions}
        drillableMerchants={drillableMerchants}
        linkParams={linkParams}
      />
    </div>
  );
}

export default function MonitorView({
  data,
  netWorth,
  savingsRate,
  savingsRateIncome,
  savingsRateSpending,
  savingsRateMonth,
  savingsRateUsesPriorCompleteMonth,
  recentTransactions,
  accountNames,
  linkParams,
  drillQuery,
  prefs,
}: Readonly<{
  data: DashboardData;
  netWorth: number;
  savingsRate: number | null;
  savingsRateIncome: number;
  savingsRateSpending: number;
  savingsRateMonth: string | null;
  savingsRateUsesPriorCompleteMonth: boolean;
  recentTransactions: RecentTransaction[];
  accountNames: Map<string, string>;
  linkParams: DrillLinkParams;
  drillQuery: { category?: string; sub?: string; merchant?: string };
  prefs?: { hideRecent?: boolean; hideBreakdowns?: boolean };
}>) {
  const monthLabels = data.monthlySpending.map((month) => formatMonth(month.month));
  const spendSeries = data.monthlySpending.map((month) => month.amount);
  const incomeSeries = data.monthlyIncome.map((month) => month.amount);
  const cashFlowSeries = spendSeries.map(
    (spend, index) => (incomeSeries[index] ?? 0) - spend,
  );
  const previousMonth = monthLabels.at(-2) ?? "last month";
  const currentNet = data.currentMonthIncome - data.currentMonthExpenses;
  const previousNet = (incomeSeries.at(-2) ?? 0) - (spendSeries.at(-2) ?? 0);
  const netWorthDelta = netWorthDeltaFromHistory(netWorth, data.netWorthHistory);
  const maxMerchant = Math.max(1, ...data.merchantBreakdown.map((item) => item.amount));
  const merchantItems = data.merchantBreakdown.map((item) => ({
    label: item.merchant,
    amount: item.amount,
    href: dashboardUrl({ ...linkParams, merchant: item.merchant }),
  }));
  const monthLinks = data.monthlySpending.map((month) =>
    dashboardUrl({ ...linkParams, ...drillQuery, month: month.month }),
  );
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
  const maxCategory = Math.max(
    1,
    ...data.categoryBreakdown.map((category) => category.amount),
  );
  const drillableMerchants = new Set(data.drillableMerchants);
  const attentionItems = getAttentionItems(data);

  return (
    <div className="space-y-5">
      <MonitorMetricTiles
        netWorth={netWorth}
        netWorthDelta={netWorthDelta}
        previousMonth={previousMonth}
        currentNet={currentNet}
        previousNet={previousNet}
        spendAmount={data.currentMonthExpenses}
        spendDelta={(spendSeries.at(-1) ?? 0) - (spendSeries.at(-2) ?? 0)}
        spendSeries={spendSeries}
        cashFlowSeries={cashFlowSeries}
        savingsRate={savingsRate}
        savingsRateIncome={savingsRateIncome}
        savingsRateSpending={savingsRateSpending}
        savingsRateMonth={savingsRateMonth}
        savingsRateUsesPriorCompleteMonth={savingsRateUsesPriorCompleteMonth}
      />
      <MonitorPlanningTiles insights={data.insights} />
      <MonitorTrendAndAttention
        monthLabels={monthLabels}
        monthLinks={monthLinks}
        spendSeries={spendSeries}
        incomeSeries={incomeSeries}
        attentionItems={attentionItems}
      />
      <RecentActivitySection
        hidden={Boolean(prefs?.hideRecent)}
        transactions={recentTransactions}
        merchantItems={merchantItems}
        accountNames={accountNames}
        maxMerchant={maxMerchant}
      />
      <MonitorBreakdowns
        hidden={Boolean(prefs?.hideBreakdowns)}
        data={data}
        linkParams={linkParams}
        showAllCategories={drillQuery.category === OTHER_CATEGORY_KEY}
        donutItems={donutItems}
        maxCategory={maxCategory}
        drillableMerchants={drillableMerchants}
      />
    </div>
  );
}
