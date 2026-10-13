import type { ReportSpendingHabitsResult } from "@/lib/report-analysis";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";

export default function ReportSpendingHabits({ habits }: Readonly<{
  habits: ReportSpendingHabitsResult;
}>) {
  const metrics = [
    { label: "Calendar-day average", value: habits.dailyAverage === null ? "Unavailable" : formatCurrency(habits.dailyAverage, habits.currency) },
    { label: "No-spend days", value: String(habits.noSpendDays) },
    { label: "Elapsed calendar days", value: String(habits.elapsedDays) },
  ];
  return (
    <Panel title="Spending habits">
      <p className="text-sm text-muted">Selected range: {`${habits.range.startDate} to ${habits.range.endDate}`} · {habits.currency}</p>
      {habits.throughDate ? (
        <p className="mt-1 text-sm text-muted">Elapsed range: {`${habits.range.startDate} to ${habits.throughDate}`}</p>
      ) : (
        <p className="mt-2 text-sm text-muted">No elapsed days in this range yet.</p>
      )}
      {habits.elapsedDays > 0 && habits.transactionCount === 0 && (
        <p className="mt-2 text-sm text-muted">No transactions in the elapsed range.</p>
      )}
      <dl className="my-5 grid gap-4 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt className="text-sm text-muted">{metric.label}</dt>
            <dd data-money className="mt-1 break-words text-xl font-semibold tabular-nums">{metric.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted">The average uses every elapsed calendar day, including days with no transactions. No-spend days have no positive expense transactions. Refunds reduce spending but do not erase a day with spending. Transfers and future days are excluded.</p>
      <table className="mt-4 w-full text-sm">
        <caption className="mb-2 text-left font-medium">Weekday spending in {habits.currency}</caption>
        <thead>
          <tr className="border-b border-panel-border text-muted">
            <th scope="col" className="py-3 text-left font-medium">Weekday</th>
            <th scope="col" className="py-3 text-right font-medium">Net spending</th>
          </tr>
        </thead>
        <tbody>
          {habits.weekdays.map((day) => (
            <tr key={day.weekday} className="border-b border-panel-border last:border-0">
              <th scope="row" className="py-2 text-left font-normal">{day.label}</th>
              <td data-money className="py-2 text-right tabular-nums">{formatCurrency(day.spending, habits.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
