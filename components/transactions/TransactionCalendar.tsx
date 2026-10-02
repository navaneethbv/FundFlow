import Link from "next/link";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import { buildCalendarDays, type CalendarSpendRow } from "@/lib/transaction-calendar";

export default function TransactionCalendar({ month, rows }: Readonly<{ month: string; rows: CalendarSpendRow[] }>) {
  const days = buildCalendarDays(month, rows);
  const tableRows = days.filter((day) => day.count > 0);
  return (
    <Panel title="Spending calendar" eyebrow="Daily outflow">
      <div className="grid grid-cols-7 gap-1.5" aria-label={`${month} spending heatmap`}>
        {days.map((day) => (
          <Link
            key={day.date}
            href={`/transactions?month=${month}&day=${day.date}`}
            aria-label={`${day.date}: ${formatCurrency(day.total)} across ${day.count} transactions`}
            className="min-h-16 rounded-field border border-panel-border p-2 text-left text-xs transition hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            style={day.intensity ? { backgroundColor: `var(--viz-${day.intensity})` } : undefined}
          >
            <span className="font-semibold">{Number(day.date.slice(-2))}</span>
            {day.count > 0 && <span className="mt-2 block font-medium" data-money>{formatCurrency(day.total)}</span>}
          </Link>
        ))}
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Daily spending table for {month}</caption>
          <thead><tr className="border-b border-panel-border text-left text-xs uppercase text-muted"><th className="py-2">Day</th><th className="py-2">Transactions</th><th className="py-2 text-right">Outflow</th></tr></thead>
          <tbody>
            {tableRows.map((day) => <tr key={day.date} className="border-b border-panel-border"><th scope="row" className="py-2 text-left font-medium"><Link className="underline-offset-2 hover:underline" href={`/transactions?month=${month}&day=${day.date}`}>{day.date}</Link></th><td className="py-2">{day.count}</td><td className="py-2 text-right" data-money>{formatCurrency(day.total)}</td></tr>)}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
