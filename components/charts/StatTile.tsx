import Sparkline from "@/components/charts/Sparkline";
import { formatCurrency } from "@/lib/format";

/**
 * Stat tile: label, value, optional signed delta vs a named period, and optional sparkline.
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
    <section className="rounded-[26px] border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] backdrop-blur-xl transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</h3>
        {trend && trend.length >= 2 && <Sparkline values={trend} />}
      </div>
      <p className="mt-3 text-3xl font-black tracking-[-0.04em]" style={{ color: "var(--viz-ink)" }}>
        {formatCurrency(value)}
      </p>
      {showDelta && (
        <p className="mt-2 text-sm font-bold" style={{ color: isGood ? "var(--viz-good)" : "var(--viz-bad)" }}>
          {delta! >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(delta!))}{" "}
          <span style={{ color: "var(--viz-muted)" }}>vs {deltaVs}</span>
        </p>
      )}
    </section>
  );
}
