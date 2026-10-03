import { compactCurrency, linePath, niceTickRange } from "@/lib/chart-utils";
import { formatCurrency, formatMonth } from "@/lib/format";
import type { GoalProjectionPoint } from "@/lib/goal-projection";

const WIDTH = 640;
const HEIGHT = 230;
const PAD = { top: 16, right: 18, bottom: 28, left: 56 };

export default function GoalProjectionChart({
  points,
  capped,
}: Readonly<{
  points: GoalProjectionPoint[];
  capped: boolean;
}>) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-muted">
        Add a target date and monthly pace to see a goal projection.
      </p>
    );
  }

  const values = points.flatMap((point) => [point.funded, point.target]);
  const ticks = niceTickRange(Math.min(...values), Math.max(...values));
  const minTick = ticks[0] ?? 0;
  const maxTick = ticks.at(-1) ?? 1;
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const xFor = (index: number) => PAD.left + (index / (points.length - 1)) * plotWidth;
  const yFor = (value: number) =>
    PAD.top + plotHeight - ((value - minTick) / (maxTick - minTick || 1)) * plotHeight;
  const fundedPoints = points.map((point, index) => ({ x: xFor(index), y: yFor(point.funded) }));
  const targetPoints = points.map((point, index) => ({ x: xFor(index), y: yFor(point.target) }));
  const firstPoint = points.at(0);
  const lastPoint = points.at(-1);
  const finalFundedPoint = fundedPoints.at(-1);

  if (!firstPoint || !lastPoint || !finalFundedPoint) {
    return null;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs font-semibold text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--viz-1)" }} aria-hidden />
          Projected funded amount
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3" style={{ background: "var(--viz-axis)" }} aria-hidden />
          Target
        </span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full max-w-[760px]"
        role="img"
        aria-label="Goal funding projection"
      >
        {ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} stroke="var(--viz-grid)" strokeWidth={1} />
              <text x={PAD.left - 7} y={y + 4} textAnchor="end" fontSize={10} fill="var(--viz-muted)" className="money">
                {compactCurrency(tick)}
              </text>
            </g>
          );
        })}
        <path d={linePath(targetPoints)} fill="none" stroke="var(--viz-axis)" strokeDasharray="5 4" strokeWidth={1.5} />
        <path d={linePath(fundedPoints)} fill="none" stroke="var(--viz-1)" strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} />
        <circle cx={finalFundedPoint.x} cy={finalFundedPoint.y} r={4} fill="var(--viz-1)" />
        <text x={PAD.left} y={HEIGHT - 7} fontSize={10} fill="var(--viz-muted)">
          {formatMonth(firstPoint.month)}
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 7} textAnchor="end" fontSize={10} fill="var(--viz-muted)">
          {formatMonth(lastPoint.month)}
        </text>
      </svg>
      <p className="mt-2 text-xs text-muted">
        This projection uses the current funded amount and the existing monthly pace. It is not a prediction.
        {capped && " The chart stops after 36 months; the target date is farther out."}
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-accent focus-visible:outline-2">
          View projection data
        </summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-xs">
            <caption className="sr-only">Goal funding projection by month</caption>
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-3 font-medium">Month</th>
                <th className="py-1 pr-3 text-right font-medium">Funded</th>
                <th className="py-1 text-right font-medium">Target</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {points.map((point) => (
                <tr key={point.month} className="border-t border-panel-border">
                  <td className="py-1 pr-3">{formatMonth(point.month)}</td>
                  <td data-money className="py-1 pr-3 text-right">{formatCurrency(point.funded)}</td>
                  <td data-money className="py-1 text-right">{formatCurrency(point.target)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
