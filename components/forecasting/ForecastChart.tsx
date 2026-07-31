import { compactCurrency, linePath, niceTicks } from "@/lib/chart-utils";
import { formatCurrency } from "@/lib/format";
import type { ForecastPoint } from "@/lib/forecasting";

/**
 * Three deterministic scenarios from the user's own assumptions, not a
 * statistical confidence band — the legend and copy say "projection", never
 * "prediction" or a probability, per the plan's explicit requirement.
 */

const WIDTH = 640;
const HEIGHT = 240;
const PAD_LEFT = 52;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;

const SERIES = [
  { key: "conservative" as const, label: "Conservative", color: "var(--viz-ink-2)", dashed: true },
  { key: "base" as const, label: "Base", color: "var(--viz-1)", dashed: false },
  { key: "optimistic" as const, label: "Optimistic", color: "var(--viz-2)", dashed: true },
];

export default function ForecastChart({
  points,
  currentNetWorth,
}: Readonly<{ points: ForecastPoint[]; currentNetWorth: number }>) {
  if (points.length === 0) return null;

  const allValues = [currentNetWorth, ...points.flatMap((p) => [p.conservative, p.base, p.optimistic])];
  const maxValue = Math.max(...allValues, 0);
  const minValue = Math.min(...allValues, 0);
  const ticks = niceTicks(maxValue - minValue);
  const maxTick = (ticks.at(-1) || 1) + minValue;

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const xFor = (i: number) => PAD_LEFT + (i / points.length) * plotWidth;
  const yFor = (value: number) =>
    PAD_TOP + plotHeight - ((value - minValue) / (maxTick - minValue || 1)) * plotHeight;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs font-semibold text-muted">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label="Net worth projection">
        {ticks.map((t) => {
          const y = yFor(t + minValue);
          return (
            <g key={t}>
              <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} stroke="var(--panel-border)" strokeWidth={1} />
              <text x={4} y={y + 4} fontSize={10} fill="var(--muted)">
                {compactCurrency(t + minValue)}
              </text>
            </g>
          );
        })}
        {SERIES.map((s) => {
          const pts = points.map((p, i) => ({ x: xFor(i + 1), y: yFor(p[s.key]) }));
          return (
            <path
              key={s.key}
              d={linePath(pts)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "4 4" : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
      {/* Table twin */}
      <table className="sr-only">
        <caption>Net worth projection by month and scenario</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Conservative</th>
            <th>Base</th>
            <th>Optimistic</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <td>{p.month}</td>
              <td>{formatCurrency(p.conservative)}</td>
              <td>{formatCurrency(p.base)}</td>
              <td>{formatCurrency(p.optimistic)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
