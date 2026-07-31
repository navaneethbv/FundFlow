import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import type { ReportSummary } from "@/lib/reports";

/**
 * The five figures the reference planner shows above a report. Income and
 * spending come from the canonical totals, so they reconcile with the Cash Flow
 * page for the same range; count, largest, and average describe the filtered
 * row set including transfers, which is what the table below lists.
 */
export default function ReportSummaryPanel({
  summary,
  currency,
}: Readonly<{ summary: ReportSummary; currency: string }>) {
  const metrics = [
    {
      label: "Transactions",
      value: new Intl.NumberFormat("en-US").format(summary.totalTransactions),
      tone: "var(--viz-ink)",
    },
    {
      label: "Income",
      value: formatCurrency(summary.totalIncome, currency),
      tone: "var(--viz-good)",
    },
    {
      label: "Spending",
      value: formatCurrency(summary.totalSpending, currency),
      tone: "var(--viz-ink)",
    },
    {
      label: "Largest",
      value: formatCurrency(Math.abs(summary.largest), currency),
      tone: summary.largest < 0 ? "var(--viz-good)" : "var(--viz-ink)",
    },
    {
      label: "Average",
      value: formatCurrency(summary.averageAbsolute, currency),
      tone: "var(--viz-ink)",
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
            <p className="eyebrow">{metric.label}</p>
            <p
              className="metric-value mt-3 truncate text-2xl sm:text-3xl"
              style={{ color: metric.tone }}
            >
              {metric.value}
            </p>
          </Panel>
        ))}
      </div>
    </section>
  );
}
