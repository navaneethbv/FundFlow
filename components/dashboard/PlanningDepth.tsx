import type { DashboardData } from "@/lib/dashboard";
import type { Goal } from "@/lib/goals";
import { buildPlanningDepthView } from "@/lib/planning-depth";
import { formatCurrency } from "@/lib/format";
import Panel from "@/components/ui/Panel";

/** Whole months from today until a YYYY-MM-DD target date (at least 1). */
function monthsUntil(date: string | null): number {
  if (!date) return 12;
  const [year, month] = date.split("-").map(Number);
  const now = new Date();
  const months =
    ((year ?? now.getFullYear()) - now.getFullYear()) * 12 +
    ((month ?? 1) - 1 - now.getMonth());
  return Math.max(1, months);
}

export default function PlanningDepth({ data, goals }: { data: DashboardData; goals: Goal[] }) {
  const view = buildPlanningDepthView({
    accounts: data.accounts.map((account) => ({
      name: account.name,
      type: account.type,
      balance: account.current_balance,
    })),
    monthlyIncome: data.currentMonthIncome,
    monthlySpend: data.currentMonthExpenses,
    goals: goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      targetAmount: goal.target_amount,
      currentAmount: goal.saved_amount,
      monthsRemaining: monthsUntil(goal.target_date),
    })),
  });
  const goalName = new Map(goals.map((goal) => [goal.id, goal.name]));

  if (!view.debtPayoff && view.sinkingFunds.length === 0) return null;

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {view.debtPayoff && (
        <Panel title="Debt payoff" eyebrow="Avalanche order">
          <div className="space-y-3 text-sm">
            {view.debtPayoff.order.map((debt, index) => (
              <div
                key={debt.id}
                className="flex items-center justify-between gap-3 rounded-field bg-panel-2 p-3"
              >
                <span className="font-semibold">
                  {index + 1}. {debt.name}
                </span>
                <span className="tabular-nums font-bold">{formatCurrency(debt.balance)}</span>
              </div>
            ))}
            <p className="mt-2 text-xs text-muted">
              At {formatCurrency(view.surplus)}/mo surplus, {view.debtPayoff.order[0]?.name} clears in
              about {view.debtPayoff.steps[0]?.payoffMonth} months, then the surplus rolls to the next.
              Highest-APR debt is paid first; unknown APRs are treated as 0%.
            </p>
          </div>
        </Panel>
      )}

      {view.sinkingFunds.length > 0 && (
        <Panel title="Sinking funds" eyebrow="Suggested contributions">
          <div className="space-y-3 text-sm">
            {view.sinkingFunds.map((suggestion) => (
              <div
                key={suggestion.goalId}
                className="flex items-center justify-between gap-3 rounded-field bg-panel-2 p-3"
              >
                <span className="font-semibold">{goalName.get(suggestion.goalId) ?? "Goal"}</span>
                <span className="tabular-nums font-bold">
                  {formatCurrency(suggestion.monthlyContribution)}/mo
                </span>
              </div>
            ))}
            <p className="mt-2 text-xs text-muted">
              From {formatCurrency(view.surplus)} monthly surplus. Confirm contributions manually.
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}
