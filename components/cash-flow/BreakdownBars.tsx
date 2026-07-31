import { foldTail } from "@/lib/chart-utils";
import type {
  BreakdownDimension,
  BreakdownRow,
} from "@/lib/cash-flow";
import { formatCurrency, titleCase } from "@/lib/format";

export default function BreakdownBars({
  title,
  rows,
  currency,
  dimension,
}: Readonly<{
  title: "Income" | "Expenses";
  rows: BreakdownRow[];
  currency: string;
  dimension: BreakdownDimension;
}>) {
  if (rows.length === 0) {
    return (
      <p className="py-4 text-sm text-muted">
        No {title.toLowerCase()} data for this period.
      </p>
    );
  }

  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const chartRows = foldTail(rows, 6, (amount) => ({
    label: "Other",
    amount,
    pct: total > 0 ? Math.round((amount / total) * 10_000) / 100 : 0,
  }));
  const color =
    title === "Income" ? "var(--viz-pos)" : "var(--viz-neg)";
  const displayLabel = (label: string) =>
    dimension === "merchant" ? label : titleCase(label);

  return (
    <div>
      <ul className="space-y-3">
        {chartRows.map((row) => {
          const label = displayLabel(row.label);
          return (
            <li key={row.label} data-breakdown-bar={label}>
              <div className="mb-1.5 flex justify-between gap-4 text-sm">
                <span className="font-medium">{label}</span>
                <span data-money className="tabular-nums font-semibold">
                  {formatCurrency(row.amount, currency)} ({row.pct}%)
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${label}, ${row.pct}% of ${title.toLowerCase()}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={row.pct}
                className="h-2.5 overflow-hidden rounded-full bg-panel-hover"
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    background: color,
                    width: `${Math.max(0, Math.min(100, row.pct))}%`,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <details className="mt-5">
        <summary className="min-h-11 cursor-pointer py-3 text-xs text-muted">
          View complete {title} table
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead>
              <tr className="border-b border-panel-border text-muted">
                <th className="py-2 pr-3 font-medium">Label</th>
                <th className="py-2 pr-3 font-medium">Amount</th>
                <th className="py-2 font-medium">Share</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-panel-border/60">
                  <td>{displayLabel(row.label)}</td>
                  <td data-money className="py-2 pr-3">
                    {formatCurrency(row.amount, currency)}
                  </td>
                  <td className="py-2">{row.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
