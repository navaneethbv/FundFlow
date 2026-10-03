import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import { buildAmortizationSchedule, type AmortizationResult } from "@/lib/amortization";
import type { DebtPlannerAccount } from "@/lib/debt-data";

type Projection = { base: AmortizationResult; withExtra: AmortizationResult | null } | { error: string };

function buildProjection(debt: DebtPlannerAccount, today: string, extraMonthly: number): Projection {
  try {
    const base = buildAmortizationSchedule({
      principal: debt.balance,
      startDate: today,
      paymentAmount: debt.minimumPayment,
      ratePeriods: [{ start: today, annualRate: debt.apr }],
    });
    const withExtra = extraMonthly > 0
      ? buildAmortizationSchedule({
          principal: debt.balance,
          startDate: today,
          paymentAmount: debt.minimumPayment + extraMonthly,
          ratePeriods: [{ start: today, annualRate: debt.apr }],
        })
      : null;
    return { base, withExtra };
  } catch (error) {
    return { error: error instanceof Error && error.message === "AMORTIZATION_NON_AMORTIZING"
      ? "The current payment does not cover projected interest. Increase the payment or enter a lower APR."
      : "This schedule could not be projected within the configured period cap." };
  }
}

export default function LoanDetail({
  debt,
  today,
  extraMonthly,
  enabled,
}: Readonly<{
  debt: DebtPlannerAccount | undefined;
  today: string;
  extraMonthly: number;
  enabled: boolean;
}>) {
  if (!enabled || !debt?.planned) return null;
  const projection = buildProjection(debt, today, extraMonthly);
  if ("error" in projection) {
    return <Panel tone="warning" eyebrow="Loan detail" title={`${debt.name} amortization`}><p className="text-sm text-muted">{projection.error}</p></Panel>;
  }
  const { base, withExtra } = projection;
  const rows = base.rows.slice(0, 60);
  const maxBalance = Math.max(...rows.map((row) => row.openingPrincipal), debt.balance, 1);
  const interestSaved = withExtra ? Math.max(0, base.totalInterest - withExtra.totalInterest) : null;

  return (
    <Panel eyebrow="Loan detail" title={`${debt.name} amortization`}>
      <p className="text-sm text-muted">This projection starts on {today}, uses the user-supplied APR, and labels every balance as a projection.</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-field bg-panel-2 p-3"><dt className="text-xs text-muted">Projected payoff</dt><dd className="mt-1 font-semibold">{base.payoffDate}</dd></div>
        <div className="rounded-field bg-panel-2 p-3"><dt className="text-xs text-muted">Projected interest</dt><dd data-money className="mt-1 font-semibold">{formatCurrency(base.totalInterest)}</dd></div>
        <div className="rounded-field bg-panel-2 p-3"><dt className="text-xs text-muted">Interest saved by extra</dt><dd data-money className="mt-1 font-semibold" style={{ color: "var(--viz-pos)" }}>{interestSaved === null ? "Add extra payment" : formatCurrency(interestSaved)}</dd></div>
      </dl>
      <div className="mt-5" aria-label="Projected balance chart">
        <h3 className="text-sm font-semibold">Projected balance</h3>
        <div className="mt-2 space-y-1" role="img" aria-label="Projected balance bars with table below">
          {rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % 6 === 0).map((row) => (
            <div key={row.period} className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-muted">Month {row.period}</span>
              <div className="h-3 min-w-0 flex-1 rounded-full bg-panel-2"><div className="h-3 rounded-full" style={{ width: `${Math.max(2, (row.closingPrincipal / maxBalance) * 100)}%`, background: "var(--viz-neg)" }} /></div>
              <span data-money className="w-20 text-right tabular-nums">{formatCurrency(row.closingPrincipal)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <caption className="sr-only">Projected amortization schedule</caption>
          <thead className="border-b border-panel-border text-xs uppercase tracking-wide text-muted"><tr><th className="px-2 py-2">Date</th><th className="px-2 py-2 text-right">Rate</th><th className="px-2 py-2 text-right">Interest</th><th className="px-2 py-2 text-right">Payment</th><th className="px-2 py-2 text-right">Extra</th><th className="px-2 py-2 text-right">Balance</th></tr></thead>
          <tbody className="divide-y divide-panel-border">
            {rows.map((row) => <tr key={row.period}><td className="px-2 py-2 tabular-nums">{row.date}</td><td className="px-2 py-2 text-right">{row.annualRate.toFixed(2)}%</td><td data-money className="px-2 py-2 text-right">{formatCurrency(row.interest)}</td><td data-money className="px-2 py-2 text-right">{formatCurrency(row.scheduledPayment)}</td><td data-money className="px-2 py-2 text-right">{formatCurrency(row.extraPayment)}</td><td data-money className="px-2 py-2 text-right font-semibold">{formatCurrency(row.closingPrincipal)}</td></tr>)}
          </tbody>
        </table>
        {base.rows.length > rows.length && <p className="mt-2 text-xs text-muted">Showing the first 60 projected periods. The payoff date above includes the full schedule.</p>}
      </div>
    </Panel>
  );
}
