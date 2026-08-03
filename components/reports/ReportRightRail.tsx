import Link from "next/link";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import type { ReportSummary } from "@/lib/reports";

/**
 * The right-rail Summary card beside the transactions table — Total
 * transactions, Largest, Average, Total income, Total spending, First/Last
 * transaction, Download CSV — all already computed by `summarizeTransactions`
 * for the stat-tile row above the chart. Repeating them here, next to the
 * actual row set, is a deliberate Monarch pattern (a "detail" card beside
 * the data, not a replacement for the "quick glance" strip at the top).
 */
export default function ReportRightRail({
  summary,
  currency,
  exportHref,
}: Readonly<{ summary: ReportSummary; currency: string; exportHref: string }>) {
  const rows: Array<{ label: string; value: string; tone?: string }> = [
    {
      label: "Total transactions",
      value: new Intl.NumberFormat("en-US").format(summary.totalTransactions),
    },
    {
      label: "Largest",
      value: formatCurrency(Math.abs(summary.largest), currency),
      tone: summary.largest < 0 ? "text-success" : undefined,
    },
    { label: "Average", value: formatCurrency(summary.averageAbsolute, currency) },
    { label: "Total income", value: formatCurrency(summary.totalIncome, currency), tone: "text-success" },
    { label: "Total spending", value: formatCurrency(summary.totalSpending, currency), tone: "text-danger" },
    {
      label: "First transaction",
      value: summary.firstDate ? formatDate(summary.firstDate) : "—",
    },
    {
      label: "Last transaction",
      value: summary.lastDate ? formatDate(summary.lastDate) : "—",
    },
  ];

  return (
    <Panel title="Summary" className="lg:sticky lg:top-5">
      <dl className="space-y-3 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-muted">{row.label}</dt>
            <dd data-money className={`font-semibold tabular-nums ${row.tone ?? ""}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <Link
        href={exportHref}
        prefetch={false}
        className="mt-4 flex min-h-11 items-center justify-center text-sm font-semibold text-accent hover:underline"
      >
        Download CSV
      </Link>
    </Panel>
  );
}
