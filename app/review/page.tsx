import AppShell from "@/components/shell/AppShell";
import BarList from "@/components/dashboard/BarList";
import ButtonLink from "@/components/ui/ButtonLink";
import Panel from "@/components/ui/Panel";
import { goalSummary } from "@/lib/goals";
import { getDashboardData } from "@/lib/dashboard";
import { formatCurrency, formatMonth, titleCase } from "@/lib/format";
import { getGoals } from "@/lib/goals";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ month?: string }>;
}

export default async function MonthlyReviewPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [data, goals] = await Promise.all([
    getDashboardData(supabase, undefined, params.month),
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">Monthly Review</p>
          <h1 className="display mt-2 text-3xl sm:text-4xl">
            {formatMonth(data.selectedMonth)} review
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            A guided snapshot of income, spending, budgets, goals, and notable changes for the month.
          </p>
        </div>
        <ButtonLink href={`/api/export/report?month=${data.selectedMonth}`}>
          Export PDF
        </ButtonLink>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Income">
          <p className="display text-3xl text-success">{formatCurrency(data.currentMonthIncome)}</p>
        </Panel>
        <Panel title="Spending">
          <p className="display text-3xl">{formatCurrency(data.currentMonthExpenses)}</p>
        </Panel>
        <Panel title="Net">
          <p className={net >= 0 ? "display text-3xl text-success" : "display text-3xl text-danger"}>
            {net >= 0 ? "+" : ""}
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
                  <span>{formatCurrency(budget.projectedSpend)} projected</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Limit {formatCurrency(budget.monthlyLimit)}, remaining {formatCurrency(budget.remaining)}
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
                <span className="font-bold">{formatCurrency(goal.remainingAmount)} left</span>
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
