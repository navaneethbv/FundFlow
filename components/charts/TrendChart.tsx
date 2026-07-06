import { niceTicks, linePath, areaPath, compactCurrency } from "@/lib/chart-utils";

export interface TrendSeries {
  name: string;
  /** Categorical slot (1-based) → CSS var --viz-N. Fixed per entity. */
  slot: number;
  values: number[];
}

/**
 * Server-rendered SVG line chart (change-over-time). 2px lines, ≥8px end
 * markers with a 2px surface ring, selective direct labels (endpoint only),
 * hairline solid gridlines, legend for ≥2 series, native tooltips per point,
 * and a <details> table view as the WCAG-clean twin.
 */
export default function TrendChart({
  series,
  labels,
  valueFormatter = compactCurrency,
}: {
  series: TrendSeries[];
  labels: string[];
  valueFormatter?: (v: number) => string;
}) {
  const W = 560;
  const H = 240;
  const PAD = { top: 14, right: 58, bottom: 26, left: 46 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const allValues = series.flatMap((s) => s.values);
  const maxValue = Math.max(0, ...allValues);
  if (maxValue <= 0 || labels.length === 0) {
    return <p className="text-sm opacity-60 py-4">No data yet.</p>;
  }

  const ticks = niceTicks(maxValue);
  const yMax = ticks[ticks.length - 1]!;
  const x = (i: number) =>
    PAD.left + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const pointsFor = (s: TrendSeries) => s.values.map((v, i) => ({ x: x(i), y: y(v) }));

  // Endpoint labels: nudge apart if two series converge at the right edge.
  const endLabelY = series.map((s) => y(s.values[s.values.length - 1] ?? 0));
  if (endLabelY.length === 2 && Math.abs(endLabelY[0]! - endLabelY[1]!) < 14) {
    const [a, b] = endLabelY[0]! <= endLabelY[1]! ? [0, 1] : [1, 0];
    const mid = (endLabelY[0]! + endLabelY[1]!) / 2;
    endLabelY[a] = mid - 8;
    endLabelY[b] = mid + 8;
  }

  return (
    <div>
      {series.length >= 2 && (
        <div className="flex flex-wrap gap-4 mb-2 text-xs" style={{ color: "var(--viz-ink-2)" }}>
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: `var(--viz-${s.slot})` }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Trend chart">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(t) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--viz-muted)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {valueFormatter(t)}
            </text>
          </g>
        ))}

        {labels.map((l, i) => (
          <text
            key={l}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize={10}
            fill="var(--viz-muted)"
          >
            {l}
          </text>
        ))}

        {/* Area wash only for a single series (a wash, never a block). */}
        {series.length === 1 && (
          <path
            d={areaPath(pointsFor(series[0]!), y(0))}
            fill={`var(--viz-${series[0]!.slot})`}
            opacity={0.1}
          />
        )}

        {series.map((s) => (
          <path
            key={s.name}
            d={linePath(pointsFor(s))}
            fill="none"
            stroke={`var(--viz-${s.slot})`}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* End markers with the 2px surface ring + endpoint direct labels. */}
        {series.map((s, si) => {
          const last = s.values.length - 1;
          return (
            <g key={s.name}>
              <circle
                cx={x(last)}
                cy={y(s.values[last] ?? 0)}
                r={4.5}
                fill={`var(--viz-${s.slot})`}
                stroke="var(--background)"
                strokeWidth={2}
              />
              <text
                x={x(last) + 8}
                y={endLabelY[si]! + 3.5}
                fontSize={11}
                fontWeight={600}
                fill="var(--viz-ink)"
              >
                {valueFormatter(s.values[last] ?? 0)}
              </text>
            </g>
          );
        })}

        {/* Generous invisible hit targets carrying native tooltips. */}
        {labels.map((l, i) => (
          <rect
            key={l}
            x={x(i) - plotW / labels.length / 2}
            y={PAD.top}
            width={plotW / labels.length}
            height={plotH}
            fill="transparent"
          >
            <title>
              {`${l}${series.map((s) => ` · ${s.name}: ${valueFormatter(s.values[i] ?? 0)}`).join("")}`}
            </title>
          </rect>
        ))}
      </svg>

      <details className="mt-1">
        <summary className="text-xs cursor-pointer" style={{ color: "var(--viz-muted)" }}>
          View data table
        </summary>
        <table className="mt-2 text-xs w-full">
          <thead>
            <tr className="text-left opacity-60">
              <th className="py-1 pr-2 font-medium">Period</th>
              {series.map((s) => (
                <th key={s.name} className="py-1 pr-2 font-medium">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {labels.map((l, i) => (
              <tr key={l} className="border-t border-black/5 dark:border-white/10">
                <td className="py-1 pr-2">{l}</td>
                {series.map((s) => (
                  <td key={s.name} className="py-1 pr-2">
                    {valueFormatter(s.values[i] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
