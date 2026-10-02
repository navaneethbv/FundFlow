import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import type { PayPeriod } from "@/lib/paycheck-planner";
export default function PaycheckPlan({
  periods,
  cash,
}: Readonly<{ periods: PayPeriod[]; cash: number | null }>) {
  return (
    <div className="space-y-5">
      <Panel>
        <p>
          This projection uses your confirmed USD pay schedule, unpaid recurring
          bills, scheduled expenses, and reported card statements. Recurring
          card purchases are excluded; the planner reserves the reported
          statement balance instead. Other loan repayments and transfers are
          outside this bill plan. Card statement settlement is not tracked;
          review those amounts before relying on the plan.
        </p>
        <p data-money className="mt-2 text-sm text-muted">
          Cash on hand: {cash === null ? "Unknown" : formatCurrency(cash)}. Only
          the bridge before payday uses this cash; later periods show what each
          expected paycheck funds.
        </p>
        <details className="mt-3 text-sm">
          <summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2">
            How funding is calculated
          </summary>
          <p>
            Bills use their due period’s paycheck first. Amounts that exceed it
            reserve earlier paychecks, nearest first. Due totals show the full
            bills; remaining subtracts only this period’s own funded shares plus
            its reserves for later bills. A negative remaining amount is a
            funding gap. No bank transfer or payment is made.
          </p>
        </details>
      </Panel>
      {periods.map((period, index) => (
        <Panel key={period.start}>
          <h2 className="text-lg font-semibold">
            {period.bridge
              ? "Before your next payday"
              : `Pay period ${index + (periods[0]?.bridge ? 0 : 1)}`}
          </h2>
          <p className="text-sm text-muted">
            {formatDate(period.start)} to {formatDate(period.end)}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-sm text-muted">Expected pay</dt>
              <dd data-money className="font-semibold">
                {formatCurrency(period.income)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Bills due</dt>
              <dd data-money className="font-semibold">
                {formatCurrency(period.due)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Reserved for later</dt>
              <dd data-money className="font-semibold">
                {formatCurrency(period.reserved)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Remaining after funding</dt>
              <dd data-money className="font-semibold">
                {period.remaining === null
                  ? "Unknown"
                  : formatCurrency(period.remaining)}
              </dd>
            </div>
          </dl>
          {period.shortfall === null ? (
            <p className="mt-3 text-sm">
              Cash is unknown; bridge coverage cannot be assessed.
            </p>
          ) : (
            period.shortfall > 0 && (
              <p data-money className="mt-3 text-sm font-semibold">
                Funding gap: {formatCurrency(period.shortfall)}
              </p>
            )
          )}
          <ul className="mt-4 space-y-2 text-sm">
            {period.bills.map((bill) => (
              <li
                data-money
                key={bill.id}
                className="rounded-card border border-panel-border p-3"
              >
                {bill.name}: {formatCurrency(bill.amount)} due{" "}
                {formatDate(bill.dueDate)}. {formatCurrency(bill.funded)} funded
                here
                {bill.funded < bill.amount
                  ? `; ${formatCurrency(bill.amount - bill.funded)} reserved earlier`
                  : ""}
                .
              </li>
            ))}
          </ul>
          {period.reserves.length > 0 && (
            <>
              <h3 className="mt-4 font-semibold">Reserves for later bills</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {period.reserves.map((bill) => (
                  <li data-money key={bill.id}>
                    {formatCurrency(bill.funded)} for {bill.name}, due{" "}
                    {formatDate(bill.dueDate)}.
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      ))}
    </div>
  );
}
