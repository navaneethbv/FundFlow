"use client";

import { useState } from "react";
import AreaSparkline from "@/components/charts/AreaSparkline";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import Badge from "@/components/ui/Badge";
import { formatCurrency, formatMonth } from "@/lib/format";

export interface NetWorthPoint {
  month: string;
  netWorth: number;
}

/** Calendar months, not a count of observations: missing snapshots never stretch a range. */
export function netWorthWindow(history: NetWorthPoint[], range: string): NetWorthPoint[] {
  if (range === "all" || history.length === 0) return history;
  const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
  const end = monthIndex(history.at(-1)!.month);
  const start = end - Number(range);
  return history.filter(point => monthIndex(point.month) >= start && monthIndex(point.month) <= end);
}

export default function NetWorthWidget({
  history,
  currency,
  error = null,
}: Readonly<{
  history: NetWorthPoint[];
  currency: string;
  error?: string | null;
}>) {
  const [range, setRange] = useState("1");
  const points = netWorthWindow(history, range);
  const latest = points.at(-1);
  const previous = points.length > 1 ? points[0] : undefined;
  // One month of history is a number, not a trend; only claim a change when
  // there is something to compare against.
  const change =
    latest && previous
      ? Math.round((latest.netWorth - previous.netWorth) * 100) / 100
      : null;

  return (
    <WidgetShell
      title="Net worth"
      error={error}
      empty={latest ? null : "Connect an account to start tracking net worth."}
      action={
        <select aria-label="Net worth timeframe" value={range} onChange={event => setRange(event.target.value)} className="min-h-11 rounded-field border border-panel-border bg-panel px-3 text-sm pointer-fine:min-h-9">
          <option value="1">1 month</option><option value="3">3 months</option><option value="6">6 months</option><option value="all">All history</option>
        </select>
      }
    >
      <p data-money className="metric-value text-2xl sm:text-3xl">
        {formatCurrency(latest?.netWorth ?? 0, currency)}
      </p>
      {latest?.month && (
        <p className="mt-1 text-xs text-muted">
          As of {formatMonth(latest.month)}
        </p>
      )}
      {change !== null && (
        <Badge tone={change >= 0 ? "success" : "danger"} className="mt-2">
          {change >= 0 ? "Up" : "Down"} {formatCurrency(Math.abs(change), currency)} in
          the available period
        </Badge>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted focus-visible:outline-2">View net worth history</summary>
        <table className="mt-2 w-full text-left"><caption className="sr-only">Available net worth snapshots</caption>
          <thead><tr><th scope="col" className="font-medium">Month</th><th scope="col" className="text-right font-medium">Net worth</th></tr></thead>
          <tbody>{points.map(point => <tr key={point.month}><th scope="row" className="py-1 font-normal">{formatMonth(point.month)}</th><td data-money className="text-right">{formatCurrency(point.netWorth, currency)}</td></tr>)}</tbody>
        </table>
      </details>
      {points.length > 1 && (
        <div className="mt-3">
          <AreaSparkline values={points.map((point) => point.netWorth)} color="var(--viz-1)" />
        </div>
      )}
    </WidgetShell>
  );
}
