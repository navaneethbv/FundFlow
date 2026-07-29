import { formatCurrency } from "@/lib/format";
import type { BudgetPageData } from "@/lib/budget-page";

export default function BudgetSummary({ data }: Readonly<{ data: BudgetPageData }>) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-panel border border-panel-border bg-panel p-4">
        <p className="text-xs font-medium text-muted">Total Planned Income</p>
        <p className="mt-1 text-2xl font-bold text-foreground">
          {formatCurrency(data.totalIncome.planned)}
        </p>
        <p className="mt-1 text-xs text-muted">
          Actual: {formatCurrency(data.totalIncome.actual)}
        </p>
      </div>

      <div className="rounded-panel border border-panel-border bg-panel p-4">
        <p className="text-xs font-medium text-muted">Total Planned Expenses</p>
        <p className="mt-1 text-2xl font-bold text-foreground">
          {formatCurrency(data.totalExpenses.planned)}
        </p>
        <p className="mt-1 text-xs text-muted">
          Actual: {formatCurrency(data.totalExpenses.actual)}
        </p>
      </div>

      <div className="rounded-panel border border-panel-border bg-panel p-4">
        <p className="text-xs font-medium text-muted">Left to Budget</p>
        <p
          className={`mt-1 text-2xl font-bold ${
            data.leftToBudget < 0 ? "text-danger" : "text-accent"
          }`}
        >
          {formatCurrency(data.leftToBudget)}
        </p>
        <p className="mt-1 text-xs text-muted">
          {data.leftToBudget >= 0 ? "Every dollar has a job" : "Planned expenses exceed income"}
        </p>
      </div>
    </div>
  );
}
