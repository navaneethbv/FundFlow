import { formatCurrency } from "@/lib/format";
import type { RecurringMonth } from "@/lib/recurring-page";

export default function MonthSummary({ data }: Readonly<{ data: RecurringMonth }>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-panel border border-panel-border bg-panel p-4">
        <p className="text-xs font-medium text-muted">Recurring Expenses</p>
        <p className="mt-1 text-2xl font-bold text-foreground">
          {formatCurrency(data.totals.expenses.remaining + data.totals.expenses.paid)}
        </p>
        <p className="mt-1 text-xs text-muted">
          Paid: {formatCurrency(data.totals.expenses.paid)} · Upcoming: {formatCurrency(data.totals.expenses.remaining)}
        </p>
      </div>

      <div className="rounded-panel border border-panel-border bg-panel p-4">
        <p className="text-xs font-medium text-muted">Recurring Income</p>
        <p className="mt-1 text-2xl font-bold text-foreground">
          {formatCurrency(data.totals.income.remaining + data.totals.income.paid)}
        </p>
        <p className="mt-1 text-xs text-muted">
          Received: {formatCurrency(data.totals.income.paid)} · Expected: {formatCurrency(data.totals.income.remaining)}
        </p>
      </div>
    </div>
  );
}
