import Panel from "@/components/ui/Panel";
import { compactCurrency, linePath, niceTickRange } from "@/lib/chart-utils";
import { formatCurrency } from "@/lib/format";
import { monteCarloProjection, type ForecastAssumptions, type ForecastStartingState, type MonteCarloOptions } from "@/lib/forecasting";

const WIDTH = 640;
const HEIGHT = 220;
const PAD_LEFT = 52;
const PAD_RIGHT = 12;
const PAD_TOP = 18;
const PAD_BOTTOM = 24;

export default function MonteCarloPanel({
  startingState,
  assumptions,
  options,
}: Readonly<{
  startingState: ForecastStartingState;
  assumptions: ForecastAssumptions;
  options: MonteCarloOptions;
}>) {
  const points = monteCarloProjection(startingState, assumptions, options);
  if (points.length === 0) return null;
  const values = points.flatMap((point) => [point.p10, point.p50, point.p90]);
  const ticks = niceTickRange(Math.min(...values), Math.max(...values));
  const minTick = ticks[0] ?? 0;
  const maxTick = ticks.at(-1) ?? 1;
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const xFor = (index: number) => PAD_LEFT + (index / points.length) * plotWidth;
  const yFor = (value: number) => PAD_TOP + plotHeight - ((value - minTick) / (maxTick - minTick || 1)) * plotHeight;
  const p50Path = linePath(points.map((point, index) => ({ x: xFor(index + 1), y: yFor(point.p50) })));

  return (
    <Panel title="Range projection" eyebrow="Seeded Monte Carlo">
      <p className="mb-3 text-sm text-muted">
        The band shows the 10th, 50th, and 90th percentiles from {options.annualVolatilityPct}% annual volatility. It is a projection, not a prediction.
      </p>
      <form method="get" action="/forecasting" className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_auto] sm:items-end">
        <input type="hidden" name="monthlySavings" value={assumptions.monthlySavings} />
        <input type="hidden" name="annualReturnPct" value={assumptions.annualReturnPct} />
        <input type="hidden" name="annualCashYieldPct" value={assumptions.annualCashYieldPct} />
        <input type="hidden" name="monthlyDebtPayment" value={assumptions.monthlyDebtPayment} />
        <input type="hidden" name="horizon" value={assumptions.horizonMonths} />
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-xs text-muted">Annual volatility %</span>
          <input name="volatilityPct" type="number" min="0" max="100" step="0.1" defaultValue={options.annualVolatilityPct} className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3" />
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-xs text-muted">Seed</span>
          <input name="seed" type="number" defaultValue={options.seed} className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3" />
        </label>
        <button type="submit" className="min-h-11 rounded-field bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground focus-visible:outline-2">Update range</button>
      </form>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full max-w-[760px]" role="img" aria-label="Seeded Monte Carlo range projection">
        {ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} stroke="var(--viz-grid)" strokeWidth={1} />
              <text x={4} y={y + 4} fontSize={10} fill="var(--muted)" className="money">{compactCurrency(tick)}</text>
            </g>
          );
        })}
        <path d={linePath(points.map((point, index) => ({ x: xFor(index + 1), y: yFor(point.p10) })))} fill="none" stroke="var(--viz-2)" strokeWidth={1} strokeDasharray="3 3" />
        <path d={p50Path} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinecap="round" />
        <path d={linePath(points.map((point, index) => ({ x: xFor(index + 1), y: yFor(point.p90) })))} fill="none" stroke="var(--viz-2)" strokeWidth={1} strokeDasharray="3 3" />
        <text x={PAD_LEFT} y={12} fontSize={9} fill="var(--muted)">p10</text>
        <text x={PAD_LEFT + 26} y={12} fontSize={9} fill="var(--viz-1)">p50</text>
        <text x={PAD_LEFT + 52} y={12} fontSize={9} fill="var(--muted)">p90</text>
      </svg>
      <div className="sr-only">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <caption>Seeded Monte Carlo projection by month and percentile</caption>
            <thead><tr><th>Month</th><th>10th percentile</th><th>50th percentile</th><th>90th percentile</th></tr></thead>
            <tbody>{points.map((point) => <tr key={point.month}><td>{point.month}</td><td data-money>{formatCurrency(point.p10)}</td><td data-money>{formatCurrency(point.p50)}</td><td data-money>{formatCurrency(point.p90)}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}
