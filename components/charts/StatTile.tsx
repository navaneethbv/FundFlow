import Sparkline from "@/components/charts/Sparkline";
import { formatCurrency } from "@/lib/format";

/**
 * Stat tile: label · value (proportional figures — never tabular-nums on a
 * large standalone number) · optional signed delta vs a named period (color =
 * direction × whether up is good) · optional sparkline.
 */
export default function StatTile({
  label,
  value,
  delta,
  deltaVs,
  upIsGood = true,
  trend,
}: {
  label: string;
  value: number;
  /** Absolute change vs the comparison period (same unit as value). */
  delta?: number;
  /** Name of the comparison period, e.g. "May 2026". */
  deltaVs?: string;
  upIsGood?: boolean;
  trend?: number[];
}) {
  const showDelta = delta !== undefined && deltaVs;
  const isGood = delta !== undefined && (delta >= 0) === upIsGood;

  return (
    <section className="rounded-2xl border border-black/10 dark:border-white/15 p-5 bg-white/40 dark:bg-black/20 backdrop-blur-sm shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider opacity-60">{label}</h3>
        {trend && trend.length >= 2 && <Sparkline values={trend} />}
      </div>
      <p className="text-2xl font-semibold mt-1" style={{ color: "var(--viz-ink)" }}>
        {formatCurrency(value)}
      </p>
      {showDelta && (
        <p className="text-xs mt-1.5 font-medium" style={{ color: isGood ? "var(--viz-good)" : "var(--viz-bad)" }}>
          {delta! >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(delta!))}{" "}
          <span style={{ color: "var(--viz-muted)" }}>vs {deltaVs}</span>
        </p>
      )}
    </section>
  );
}
