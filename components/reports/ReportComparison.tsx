import ScrollableRegion from "@/components/ui/ScrollableRegion";
import type { ReportComparisonResult } from "@/lib/report-analysis";
import Panel from "@/components/ui/Panel";
import { formatCurrency, inflowMarker } from "@/lib/format";

function PercentageChange({ value }: Readonly<{ value: number | null }>) {
  return (
    <span data-money>
      {value === null ? "Unavailable (zero reference)" : `${inflowMarker(value)}${value}%`}
    </span>
  );
}

export default function ReportComparison({
  comparison,
  referenceLabel = "Reference period",
}: Readonly<{
  comparison: ReportComparisonResult;
  referenceLabel?: string;
}>) {
  const metrics = [
    { label: "Income", value: comparison.income },
    { label: "Spending", value: comparison.spending },
    { label: "Net", value: comparison.net },
  ];
  const money = (value: number) => formatCurrency(value, comparison.currency);
  const change = (value: number) => `${inflowMarker(value)}${money(value)}`;
  const hasZeroBaseline = metrics.some(({ value }) => value.percentageChange === null)
    || comparison.categories.some((category) => category.percentageChange === null);
  return (
    <section aria-labelledby="report-comparison-heading" className="space-y-4">
      <div>
        <h2 id="report-comparison-heading" className="card-title">Period comparison</h2>
        <p className="mt-2 text-sm text-muted">
          Current: {`${comparison.currentRange.startDate} to ${comparison.currentRange.endDate}`} · {comparison.currency}
        </p>
        <p className="mt-1 text-sm text-muted">
          {referenceLabel}: {`${comparison.referenceRange.startDate} to ${comparison.referenceRange.endDate}`}
        </p>
        {comparison.currentCount === 0 && <p className="mt-2 text-sm text-muted">No transactions in the current period.</p>}
        {comparison.referenceCount === 0 && <p className="mt-2 text-sm text-muted">No transactions in the reference period.</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {metrics.map(({ label, value }) => (
          <Panel key={label}>
            <h3 className="eyebrow">{label}</h3>
            <p data-money className="mt-2 break-words text-2xl font-semibold tabular-nums">{money(value.current)}</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted">Reference</dt>
                <dd data-money className="break-words tabular-nums">{money(value.reference)}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted">Change</dt>
                <dd data-money className="break-words tabular-nums">{change(value.change)}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted">Change %</dt>
                <dd className="tabular-nums"><PercentageChange value={value.percentageChange} /></dd>
              </div>
            </dl>
          </Panel>
        ))}
      </div>
      <p className="text-sm text-muted">
        Changes are current minus reference. Percentages use the absolute reference amount.
        {hasZeroBaseline && " Percentage change unavailable: reference amount is zero."}
      </p>
      <Panel title="Category spending changes">
        <p className="mb-3 text-sm text-muted">Refunds reduce spending. Transfers are excluded. Categories from both periods are included.</p>
        {comparison.categories.length === 0 ? (
          <p className="text-sm text-muted">No spending categories in either period.</p>
        ) : (
          <ScrollableRegion className="overflow-x-auto rounded-sm focus-visible:outline-2 focus-visible:outline-accent" label="Category spending changes table">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">Category spending changes in {comparison.currency}</caption>
              <thead>
                <tr className="border-b border-panel-border text-muted">
                  <th scope="col" className="py-3 pr-4 text-left font-medium">Category</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Current</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Reference</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Change</th>
                  <th scope="col" className="py-3 pl-3 text-right font-medium">Change %</th>
                </tr>
              </thead>
              <tbody>
                {comparison.categories.map((category) => (
                  <tr key={category.key} className="border-b border-panel-border last:border-0">
                    <th scope="row" className="py-3 pr-4 text-left font-medium">
                      {category.label}<span className="mt-1 block text-xs font-normal text-muted">{category.groupLabel}</span>
                    </th>
                    <td data-money className="px-3 py-3 text-right tabular-nums">{money(category.current)}</td>
                    <td data-money className="px-3 py-3 text-right tabular-nums">{money(category.reference)}</td>
                    <td data-money className="px-3 py-3 text-right tabular-nums">{change(category.change)}</td>
                    <td className="py-3 pl-3 text-right tabular-nums"><PercentageChange value={category.percentageChange} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableRegion>
        )}
      </Panel>
    </section>
  );
}
