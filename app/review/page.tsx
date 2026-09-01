import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import BarList from "@/components/dashboard/BarList";
import ExportReportButton from "@/components/review/ExportReportButton";
import Panel from "@/components/ui/Panel";
import { goalSummary, getGoals } from "@/lib/goals";
import { getDashboardData } from "@/lib/dashboard";
import { formatCurrency, formatMonth, gainLossColor, inflowMarker, titleCase } from "@/lib/format";
import { firstSearchParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata = {
  title: "Monthly review",
};

export default async function MonthlyReviewPage({ searchParams }: Readonly<PageProps>) {
  const params = await searchParams;
  const month = firstSearchParam(params.month);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [data, goals] = await Promise.all([
    getDashboardData(supabase, undefined, month),
    getGoals(supabase),
  ]);

  const net = data.currentMonthIncome - data.currentMonthExpenses;
  const goalsSummary = goalSummary(goals).slice(0, 4);
  const topCategories = data.categoryBreakdown.slice(0, 5).map((category) => ({
    label: titleCase(category.category),
    amount: category.amount,
  }));
  const topCategoryMax = Math.max(1, ...topCategories.map((category) => category.amount));
  const budgetIssues = data.budgetEnvelopes.filter((budget) => budget.status !== "on-track");

  return (
    <AppShell active="reports" email={user?.email}>
      <PageHeader
        title={`${formatMonth(data.selectedMonth)} review`}
        actions={<ExportReportButton month={data.selectedMonth} />}
      />
      <p className="max-w-2xl text-sm text-muted">
        A guided snapshot of income, spending, budgets, goals, and notable changes for the month.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Income">
          <p className="money display text-3xl" style={{ color: "var(--viz-pos)" }}>
            {formatCurrency(data.currentMonthIncome)}
          </p>
        </Panel>
        <Panel title="Spending">
          <p className="money display text-3xl" style={{ color: "var(--viz-neg)" }}>
            {formatCurrency(data.currentMonthExpenses)}
          </p>
        </Panel>
        <Panel title="Net">
          <p
            data-money
            className="display text-3xl"
            style={{ color: gainLossColor(net) }}
          >
            {inflowMarker(net)}
            {formatCurrency(net)}
          </p>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Top spending categories" eyebrow="This month">
          <BarList items={topCategories} max={topCategoryMax} />
        </Panel>
        <Panel title="Budget review" eyebrow="Envelope status">
          <div className="space-y-3 text-sm">
            {budgetIssues.map((budget) => (
              <div key={budget.category} className="rounded-field bg-panel-2 p-3">
                <div className="flex justify-between gap-3 font-semibold">
                  <span>{titleCase(budget.category)}</span>
                  <span data-money style={{ color: "var(--viz-neg)" }}>
                    {formatCurrency(budget.projectedSpend)} projected
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Limit <span data-money>{formatCurrency(budget.monthlyLimit)}</span>, remaining{" "}
                  <span
                    data-money
                    style={{ color: budget.remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
                  >
                    {formatCurrency(budget.remaining)}
                  </span>
                </p>
              </div>
            ))}
            {budgetIssues.length === 0 && (
              <p className="py-4 text-sm text-muted">No budget categories are projected over limit.</p>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Goals review" eyebrow="Pace">
          <div className="space-y-3 text-sm">
            {goalsSummary.map((goal) => (
              <div key={goal.goal.id} className="flex justify-between gap-4 rounded-field bg-panel-2 p-3">
                <span>
                  <span className="block font-semibold">{goal.goal.name}</span>
                  <span className="block text-xs text-muted">{goal.status}</span>
                </span>
                <span data-money className="font-bold">
                  {formatCurrency(goal.remainingAmount)} left
                </span>
              </div>
            ))}
            {goalsSummary.length === 0 && <p className="py-4 text-sm text-muted">No active goals yet.</p>}
          </div>
        </Panel>
        <Panel title="Notable changes" eyebrow="Review prompts">
          <div className="space-y-3 text-sm">
            {data.spendingAnomalies.slice(0, 5).map((anomaly) => (
              <p key={`${anomaly.kind}-${anomaly.transactionId ?? anomaly.category}`} className="rounded-field bg-panel-2 p-3 text-muted">
                {anomaly.message}
              </p>
            ))}
            {data.spendingAnomalies.length === 0 && (
              <p className="py-4 text-sm text-muted">No unusual spending patterns detected.</p>
            )}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
