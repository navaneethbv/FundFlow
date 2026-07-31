import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import type { RecurringMonth } from "@/lib/recurring-page";

function ProgressRow({
  label,
  paid,
  remaining,
  currency,
}: Readonly<{ label: string; paid: number; remaining: number; currency: string }>) {
  const total = paid + remaining;
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-muted">
          {formatCurrency(paid, currency)} of {formatCurrency(total, currency)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} progress`}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-panel-hover"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function MonthSummary({
  totals,
  currency,
}: Readonly<{ totals: RecurringMonth["totals"]; currency: string }>) {
  return (
    <Panel title="This month" eyebrow="Progress">
      <div className="space-y-4">
        <ProgressRow label="Income" paid={totals.income.paid} remaining={totals.income.remaining} currency={currency} />
        <ProgressRow label="Expenses" paid={totals.expenses.paid} remaining={totals.expenses.remaining} currency={currency} />
        {(totals.creditCards.paid > 0 || totals.creditCards.remaining > 0) && (
          <ProgressRow
            label="Credit cards"
            paid={totals.creditCards.paid}
            remaining={totals.creditCards.remaining}
            currency={currency}
          />
        )}
      </div>
    </Panel>
  );
}
