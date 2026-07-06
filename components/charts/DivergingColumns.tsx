import { niceTicks, compactCurrency } from "@/lib/chart-utils";

/**
 * Diverging columns around a zero baseline — polarity data (money in vs money
 * out). Uses the diverging pair (--viz-pos / --viz-neg), one shared scale for
 * both arms (never two axes), ≤24px columns with a 4px rounded data-end and a
 * square baseline end, hairline grid, legend + native tooltips + table twin.
 */
export default function DivergingColumns({
  labels,
  up,
  down,
  upName,
  downName,
  valueFormatter = compactCurrency,
}: {
  labels: string[];
  up: number[];
  down: number[];
  upName: string;
  downName: string;
  valueFormatter?: (v: number) => string;
}) {
  const W = 560;
  const H = 260;
  const PAD = { top: 16, right: 16, bottom: 26, left: 46 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxArm = Math.max(0, ...up, ...down);
  if (maxArm <= 0 || labels.length === 0) {
    return <p className="text-sm opacity-60 py-4">No data yet.</p>;
  }

  const ticks = niceTicks(maxArm, 2);
  const armMax = ticks[ticks.length - 1]!;
  const zeroY = PAD.top + plotH / 2;
  const yUp = (v: number) => zeroY - (v / armMax) * (plotH / 2);
  const yDown = (v: number) => zeroY + (v / armMax) * (plotH / 2);

  const band = plotW / labels.length;
  const colW = Math.min(24, band * 0.5);
  const xMid = (i: number) => PAD.left + band * i + band / 2;

  // Column with a 4px rounded data-end, square at the baseline.
  function column(i: number, value: number, direction: "up" | "down"): string {
    const h = Math.abs((value / armMax) * (plotH / 2));
    if (h <= 0) return "";
    const r = Math.min(4, h, colW / 2);
    const x0 = xMid(i) - colW / 2;
    const x1 = xMid(i) + colW / 2;
    if (direction === "up") {
      const yTop = zeroY - h;
      return `M${x0} ${zeroY} L${x0} ${yTop + r} Q${x0} ${yTop} ${x0 + r} ${yTop} L${x1 - r} ${yTop} Q${x1} ${yTop} ${x1} ${yTop + r} L${x1} ${zeroY} Z`;
    }
    const yBot = zeroY + h;
    return `M${x0} ${zeroY} L${x0} ${yBot - r} Q${x0} ${yBot} ${x0 + r} ${yBot} L${x1 - r} ${yBot} Q${x1} ${yBot} ${x1} ${yBot - r} L${x1} ${zeroY} Z`;
  }

  const gridLevels = ticks.slice(1); // skip 0 — the baseline carries it

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-2 text-xs" style={{ color: "var(--viz-ink-2)" }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "var(--viz-pos)" }} />
          {upName}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "var(--viz-neg)" }} />
          {downName}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${upName} vs ${downName}`}>
        {gridLevels.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yUp(t)} y2={yUp(t)} stroke="var(--viz-grid)" strokeWidth={1} />
            <line x1={PAD.left} x2={W - PAD.right} y1={yDown(t)} y2={yDown(t)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={yUp(t) + 3} textAnchor="end" fontSize={10} fill="var(--viz-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {valueFormatter(t)}
            </text>
            <text x={PAD.left - 6} y={yDown(t) + 3} textAnchor="end" fontSize={10} fill="var(--viz-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {valueFormatter(-t)}
            </text>
          </g>
        ))}

        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke="var(--viz-axis)" strokeWidth={1} />

        {labels.map((l, i) => (
          <g key={l}>
            <path d={column(i, up[i] ?? 0, "up")} fill="var(--viz-pos)" />
            <path d={column(i, down[i] ?? 0, "down")} fill="var(--viz-neg)" />
            <text x={xMid(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--viz-muted)">
              {l}
            </text>
            <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent">
              <title>
                {`${l} · ${upName}: ${valueFormatter(up[i] ?? 0)} · ${downName}: ${valueFormatter(down[i] ?? 0)} · Net: ${valueFormatter((up[i] ?? 0) - (down[i] ?? 0))}`}
              </title>
            </rect>
          </g>
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
              <th className="py-1 pr-2 font-medium">{upName}</th>
              <th className="py-1 pr-2 font-medium">{downName}</th>
              <th className="py-1 pr-2 font-medium">Net</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {labels.map((l, i) => (
              <tr key={l} className="border-t border-black/5 dark:border-white/10">
                <td className="py-1 pr-2">{l}</td>
                <td className="py-1 pr-2">{valueFormatter(up[i] ?? 0)}</td>
                <td className="py-1 pr-2">{valueFormatter(down[i] ?? 0)}</td>
                <td className="py-1 pr-2">{valueFormatter((up[i] ?? 0) - (down[i] ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
