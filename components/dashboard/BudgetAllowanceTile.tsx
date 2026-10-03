import type { BudgetAllowance } from "@/lib/budget-allowance";
import { formatCurrency } from "@/lib/format";
export default function BudgetAllowanceTile({
  allowance,
}: Readonly<{ allowance: BudgetAllowance | null }>) {
  return (
    <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
      <h3 className="eyebrow">Budget daily allowance</h3>
      {allowance ? (
        <>
          <p className="metric-value mt-3 text-3xl">
            {formatCurrency(allowance.daily)}
            <span className="text-sm"> / day</span>
          </p>
          <p data-money className="mt-2 text-xs font-medium text-muted">
            {formatCurrency(allowance.left)} budget left across{" "}
            {allowance.daysLeft} days, through {allowance.monthEnd}.
          </p>
          {allowance.left < 0 && (
            <p className="mt-2 text-sm text-danger">
              Spending is over the monthly budget.
            </p>
          )}
          {allowance.nextPayday && (
            <p className="mt-2 text-xs text-muted">
              Confirmed payday: {allowance.nextPayday} (
              {allowance.daysUntilPayday} days away).
            </p>
          )}
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-offset-4">
              How this is calculated
            </summary>
            <p data-money className="mt-2">
              Monthly expense limits plus rollover (
              {formatCurrency(allowance.budget)}), less net spending (
              {formatCurrency(allowance.spent)}), divided by days remaining
              including today. Refunds reduce spending; transfers and card
              payments are excluded. Unbudgeted purchases still count. This
              budget pace does not measure cash available, subtract future
              bills, or reset at payday.
            </p>
          </details>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">
          Set monthly expense budgets and view this month across all accounts to
          see your allowance. This guidance currently requires USD accounts.
        </p>
      )}
    </section>
  );
}
