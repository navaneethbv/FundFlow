import type { ReactNode } from "react";
import Sparkline from "@/components/charts/Sparkline";
import { formatCurrency } from "@/lib/format";

/**
 * Stat tile: label, value, optional signed delta vs a named period, and a
 * decorative mini chart. Pass `chart` for a bespoke visual (area glow, mini
 * bars, ...); otherwise `trend` renders the default sparkline.
 */
export default function StatTile({
  label,
  value,
  delta,
  deltaVs,
  upIsGood = true,
  trend,
  chart,
}: Readonly<{
  label: string;
  value: number;
  /** Absolute change vs the comparison period (same unit as value). */
  delta?: number;
  /** Name of the comparison period, e.g. "May 2026". */
  deltaVs?: string;
  upIsGood?: boolean;
  trend?: number[];
  /** Decorative mini chart; overrides the default sparkline when provided. */
  chart?: ReactNode;
}>) {
  const showDelta = delta !== undefined && deltaVs;
  // An unchanged figure is neither good nor bad. Reading `delta >= 0` as "up"
  // paints a flat $0.00 green on one tile and red on the next, which is the
  // one thing a delta must never do: imply a movement that did not happen.
  const isFlat = delta === 0;
  const isGood = delta !== undefined && (delta > 0) === upIsGood;
  const deltaClass = isFlat ? "text-muted" : isGood ? "text-success" : "text-danger";

  return (
    <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
      {/* Fixed height, not min-height: the mini charts differ in height
          (area 44px, sparkline 30px) and a two-line label is taller than a
          one-line one, so anything elastic here lands the values in a row at
          different baselines. */}
      <div className="flex h-11 items-start justify-between gap-2">
        <h3 className="eyebrow">{label}</h3>
        {chart ?? (trend && trend.length >= 2 && <Sparkline values={trend} />)}
      </div>
      <p data-money className="metric-value mt-3 text-3xl">
        {formatCurrency(value)}
      </p>
      {showDelta && (
        <p className={`mt-2 text-sm font-bold ${deltaClass}`}>
          {isFlat ? (
            "No change"
          ) : (
            <>
              {delta! > 0 ? "▲" : "▼"}{" "}
              <span data-money>{formatCurrency(Math.abs(delta!))}</span>
            </>
          )}{" "}
          <span className="text-muted">vs {deltaVs}</span>
        </p>
      )}
    </section>
  );
}
