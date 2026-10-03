import type { PeriodCashFlow } from "@/lib/cash-flow";
import {
  buildCashFlowWaterfall,
  type CashFlowWaterfallKind,
} from "@/lib/cash-flow-waterfall";
import { formatCurrency } from "@/lib/format";

const WIDTH = 560;
const HEIGHT = 280;
const PAD = { top: 26, right: 20, bottom: 62, left: 20 };

function colorFor(kind: CashFlowWaterfallKind): string {
  switch (kind) {
    case "income":
      return "var(--viz-pos)";
    case "expenses":
      return "var(--viz-neg)";
    case "savings":
      return "var(--viz-1)";
  }
}

export default function CashFlowWaterfall({
  period,
  currency,
}: Readonly<{
  period: PeriodCashFlow | null;
  currency: string;
}>) {
  const steps = buildCashFlowWaterfall(period);
  if (steps.length === 0) {
    return <p className="py-4 text-sm text-muted">No selected-period totals are available.</p>;
  }

  const maxAbs = Math.max(
    1,
    ...steps.flatMap((step) => [Math.abs(step.start), Math.abs(step.end)]),
  );
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const zeroY = PAD.top + plotH / 2;
  const yFor = (value: number) => zeroY - (value / maxAbs) * (plotH / 2);
  const band = plotW / steps.length;
  const barW = Math.min(108, band * 0.62);
  const chartLabel = `${period?.label ?? "Selected period"} cash flow waterfall`;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-[var(--viz-ink-2)]">
        {steps.map((step) => (
          <span key={step.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: colorFor(step.key) }}
            />
            {step.label}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full max-w-[760px]"
        role="img"
        aria-label={chartLabel}
      >
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--viz-axis)"
          strokeWidth={1}
        />
        {steps.map((step, index) => {
          const x = PAD.left + band * index + (band - barW) / 2;
          const startY = yFor(step.start);
          const endY = yFor(step.end);
          const y = Math.min(startY, endY);
          const height = Math.max(1, Math.abs(endY - startY));
          const center = x + barW / 2;
          const labelY = step.amount >= 0 ? y - 8 : y + height + 16;
          const amountLabel = formatCurrency(step.amount, currency);
          return (
            <g key={step.key}>
              {index > 0 && (
                <line
                  x1={PAD.left + band * (index - 1) + band / 2 + barW / 2}
                  x2={x}
                  y1={yFor(steps[index - 1]?.end ?? 0)}
                  y2={yFor(step.start)}
                  stroke="var(--viz-grid)"
                  strokeDasharray="3 3"
                />
              )}
              <rect
                x={x}
                y={y}
                width={barW}
                height={height}
                rx={4}
                fill={colorFor(step.key)}
              >
                <title>{`${step.label}: ${amountLabel}; balance ${formatCurrency(step.end, currency)}`}</title>
              </rect>
              <text
                x={center}
                y={labelY}
                textAnchor="middle"
                fontSize={11}
                fill="var(--viz-ink)"
                className="money"
              >
                {amountLabel}
              </text>
              <text
                x={center}
                y={HEIGHT - 28}
                textAnchor="middle"
                fontSize={11}
                fill="var(--viz-muted)"
              >
                {step.label}
              </text>
            </g>
          );
        })}
      </svg>

      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-muted">View data table</summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-xs">
            <caption className="sr-only">{chartLabel}</caption>
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-2 font-medium">Step</th>
                <th className="py-1 pr-2 font-medium">Change</th>
                <th className="py-1 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {steps.map((step) => (
                <tr key={step.key} className="border-t border-panel-border">
                  <th scope="row" className="py-1 pr-2 text-left font-medium">
                    {step.label}
                  </th>
                  <td data-money className="py-1 pr-2">
                    {formatCurrency(step.amount, currency)}
                  </td>
                  <td data-money className="py-1">
                    {formatCurrency(step.end, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
