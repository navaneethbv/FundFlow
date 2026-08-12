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
        {chartRows.map((row, index) => {
          const label = displayLabel(row.label);
          return (
            <li key={`${index}-${row.label}`} data-breakdown-bar={label}>
              <div className="mb-1.5 flex justify-between gap-4 text-sm">
                <span className="font-medium">{label}</span>
                <span data-money className="tabular-nums font-semibold">
                  {formatCurrency(row.amount, currency)} ({row.pct}%)
                </span>
              </div>
              <progress
                value={Math.max(0, Math.min(100, row.pct))}
                max={100}
                aria-label={`${label}, ${row.pct}% of ${title.toLowerCase()}`}
                // `appearance-none` is load-bearing: without it Blink/WebKit
                // paint their own track and ignore `bg-panel-hover` and the
                // radius. It also drops `accent-color`, so the fill is painted
                // explicitly via the pseudo-elements, inheriting `currentColor`
                // (Firefox fills `::-moz-progress-bar`, Blink/WebKit fill
                // `::-webkit-progress-value` inside `::-webkit-progress-bar`).
                className="h-2.5 w-full appearance-none overflow-hidden rounded-full bg-panel-hover [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-[currentColor] [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-[currentColor]"
                style={{ color }}
              />
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
