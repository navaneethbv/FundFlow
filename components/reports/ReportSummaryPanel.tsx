import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import type { ReportSummary } from "@/lib/reports";

/**
 * The five figures the reference planner shows above a report. Income and
 * spending come from the canonical totals, so they reconcile with the Cash Flow
 * page for the same range; count, largest, and average describe the filtered
 * row set including transfers, which is what the table below lists.
 *
 * Value-first, uppercase micro-label below — Monarch's stat-tile anatomy,
 * the reverse of the eyebrow-above-value order every other panel in this app
 * uses. Income is green and spending is red here specifically (a summary
 * tile's aggregate direction), which is a deliberately different rule from
 * the ledger row's debit/credit convention (never colors a debit red).
 */
export default function ReportSummaryPanel({
  summary,
  currency,
}: Readonly<{ summary: ReportSummary; currency: string }>) {
  const metrics = [
    {
      label: "Transactions",
      value: new Intl.NumberFormat("en-US").format(summary.totalTransactions),
      tone: "text-foreground",
    },
    {
      label: "Income",
      value: formatCurrency(summary.totalIncome, currency),
      tone: "text-success",
    },
    {
      label: "Spending",
      value: formatCurrency(summary.totalSpending, currency),
      tone: "text-danger",
    },
    {
      label: "Largest",
      value: formatCurrency(Math.abs(summary.largest), currency),
      tone: summary.largest < 0 ? "text-success" : "text-foreground",
    },
    {
      label: "Average",
      value: formatCurrency(summary.averageAbsolute, currency),
      tone: "text-foreground",
    },
  ];

  return (
    <section aria-labelledby="report-summary-heading">
      <h2 id="report-summary-heading" className="eyebrow mb-3">
        {summary.firstDate && summary.lastDate
          ? `${summary.firstDate} to ${summary.lastDate}`
          : "No transactions in this range"}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <Panel key={metric.label} className="min-w-0">
            <p data-money className={`metric-value truncate text-2xl sm:text-3xl ${metric.tone}`}>
              {metric.value}
            </p>
            <p className="eyebrow mt-3">{metric.label}</p>
          </Panel>
        ))}
      </div>
    </section>
  );
}
