import Panel from "@/components/ui/Panel";
import ProgressBar from "@/components/ui/ProgressBar";
import { formatCurrency } from "@/lib/format";
import type { RecurringMonth } from "@/lib/recurring-page";

function SummaryColumn({
  label,
  paid,
  remaining,
  currency,
  emptyAction,
}: Readonly<{
  label: string;
  paid: number;
  remaining: number;
  currency: string;
  /** Income has no bar to show until there's a stream to track — Monarch
   * offers "Add recurring income" in that empty slot instead of a 0% bar. */
  emptyAction?: React.ReactNode;
}>) {
  const total = paid + remaining;
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{label}</span>
        {total > 0 && (
          <span data-money className="text-muted">{formatCurrency(total, currency)} total</span>
        )}
      </div>
      {total > 0 ? (
        <>
          <ProgressBar className="mt-2" percent={pct} ariaLabel={`${label} progress`} />
          <p className="mt-1.5 text-xs text-muted">
            <span data-money>{formatCurrency(paid, currency)} paid</span> ·{" "}
            <span data-money>{formatCurrency(remaining, currency)} remaining</span>
          </p>
        </>
      ) : (
        emptyAction ?? <p className="mt-2 text-xs text-muted">Nothing this month.</p>
      )}
    </div>
  );
}

/**
 * A single full-width strip with one column per money type, matching
 * Monarch's placement above the occurrence list rather than beside it as a
 * right rail.
 */
export default function MonthSummary({
  totals,
  currency,
}: Readonly<{ totals: RecurringMonth["totals"]; currency: string }>) {
  return (
    <Panel>
      <div className="grid gap-6 sm:grid-cols-3">
        <SummaryColumn
          label="Income"
          paid={totals.income.paid}
          remaining={totals.income.remaining}
          currency={currency}
          emptyAction={
            <p className="mt-2 text-xs text-muted">
              Add a manual income item in the &quot;All&quot; tab below.
            </p>
          }
        />
        <SummaryColumn
          label="Expenses"
          paid={totals.expenses.paid}
          remaining={totals.expenses.remaining}
          currency={currency}
        />
        <SummaryColumn
          label="Credit cards"
          paid={totals.creditCards.paid}
          remaining={totals.creditCards.remaining}
          currency={currency}
          emptyAction={<p className="mt-2 text-xs text-muted">No credit-card bills tracked.</p>}
        />
      </div>
    </Panel>
  );
}
