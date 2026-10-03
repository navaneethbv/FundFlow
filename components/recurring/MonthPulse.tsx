import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import type { RecurringOccurrence } from "@/lib/recurring-page";

export default function MonthPulse({
  occurrences,
  currency,
}: Readonly<{ occurrences: RecurringOccurrence[]; currency: string }>) {
  const expenses = occurrences.filter((row) => !row.isIncome);
  const paid = expenses.filter((row) => row.status === "complete").reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const remaining = expenses.filter((row) => row.status !== "complete").reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const overdue = expenses.filter((row) => row.status === "overdue").length;
  const next = expenses.filter((row) => row.status === "upcoming").sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  return (
    <Panel title="Month pulse" eyebrow="Bills at a glance">
      <dl className="grid gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Paid</dt>
          <dd data-money className="mt-1 text-lg font-semibold">{formatCurrency(paid, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Still due</dt>
          <dd data-money className="mt-1 text-lg font-semibold">{formatCurrency(remaining, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Overdue</dt>
          <dd className="mt-1 text-lg font-semibold">{overdue}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Next bill</dt>
          <dd className="mt-1 text-sm font-semibold">
            {next ? `${next.merchant} · ${next.dueDate}` : "All caught up"}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-muted">Projected bills are reminders only and are excluded from account totals.</p>
    </Panel>
  );
}
