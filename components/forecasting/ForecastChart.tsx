import { compactCurrency, linePath, niceTickRange } from "@/lib/chart-utils";
import { formatCurrency } from "@/lib/format";
import type { ForecastMilestone, ForecastPoint } from "@/lib/forecasting";

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
  milestones = [],
}: Readonly<{
  points: ForecastPoint[];
  currentNetWorth: number;
  milestones?: ForecastMilestone[];
}>) {
  if (points.length === 0) return null;

  const scenariosAreDegenerate = points.every(
    (point) =>
      point.conservative === point.base && point.base === point.optimistic,
  );
  const visibleSeries = scenariosAreDegenerate
    ? SERIES.filter((series) => series.key === "base")
    : SERIES;

  const allValues = [currentNetWorth, ...points.flatMap((p) => [p.conservative, p.base, p.optimistic])];
  const ticks = niceTickRange(Math.min(...allValues), Math.max(...allValues));
  const minTick = ticks[0] ?? 0;
  const maxTick = ticks.at(-1) ?? 1;

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const xFor = (i: number) => PAD_LEFT + (i / points.length) * plotWidth;
  const yFor = (value: number) =>
    PAD_TOP + plotHeight - ((value - minTick) / (maxTick - minTick || 1)) * plotHeight;
  const markerMilestones = milestones
    .filter((milestone) => milestone.reachedMonth !== null)
    .slice(0, 6);
  const xForMilestone = (month: number) =>
    PAD_LEFT + (Math.max(0, Math.min(points.length, month)) / points.length) * plotWidth;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs font-semibold text-muted">
        {visibleSeries.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full max-w-[760px]" role="img" aria-label="Net worth projection">
        {ticks.map((t) => {
          const y = yFor(t);
          return (
            <g key={t}>
              <line
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"}
                strokeWidth={1}
              />
              <text x={4} y={y + 4} fontSize={10} fill="var(--muted)" className="money">
                {compactCurrency(t)}
              </text>
            </g>
          );
        })}
        {visibleSeries.map((s) => {
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
        {markerMilestones.map((milestone, index) => {
          const x = xForMilestone(milestone.reachedMonth ?? 0);
          const label = milestone.name.replace("Financial Independence (FIRE)", "FIRE");
          const labelWidth = Math.max(46, label.length * 5.8 + 12);
          const labelX = Math.max(PAD_LEFT, Math.min(WIDTH - PAD_RIGHT - labelWidth, x - labelWidth / 2));
          return (
            <g key={milestone.id}>
              <line
                x1={x}
                x2={x}
                y1={PAD_TOP}
                y2={HEIGHT - PAD_BOTTOM}
                stroke="var(--viz-3)"
                strokeDasharray="2 3"
                strokeWidth={1}
              />
              <rect x={labelX} y={2 + (index % 2) * 14} width={labelWidth} height={12} rx={6} fill="var(--panel)" stroke="var(--viz-3)" />
              <text x={labelX + labelWidth / 2} y={10 + (index % 2) * 14} textAnchor="middle" fontSize={8} fontWeight={600} fill="var(--foreground)">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      {/* Table twin. `sr-only` goes on a normal wrapper div, never directly on
          the table: an absolutely-positioned table's column layout can still
          widen the document, and Tailwind's sr-only clip does not always
          contain it (the Optimistic column leaked a 399px document at 390px).
          The wrapper clips it, and the inner overflow-x:auto constrains long
          values inside the hidden representation. */}
      <div className="sr-only">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <caption>Net worth projection by month and scenario</caption>
            <thead>
              <tr>
                <th>Month</th>
                {!scenariosAreDegenerate && <th>Conservative</th>}
                <th>Base</th>
                {!scenariosAreDegenerate && <th>Optimistic</th>}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.month}>
                  <td>{p.month}</td>
                  {!scenariosAreDegenerate && <td data-money>{formatCurrency(p.conservative)}</td>}
                  <td data-money>{formatCurrency(p.base)}</td>
                  {!scenariosAreDegenerate && <td data-money>{formatCurrency(p.optimistic)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
