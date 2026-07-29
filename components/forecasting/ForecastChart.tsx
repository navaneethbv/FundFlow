"use client";

import { formatCurrency } from "@/lib/format";
import type { ForecastPoint } from "@/lib/forecasting";

export default function ForecastChart({
  points,
}: Readonly<{
  points: ForecastPoint[];
}>) {
  const maxVal = Math.max(1, ...points.map((p) => p.optimistic));
  const minVal = Math.min(0, ...points.map((p) => p.conservative));
  const range = maxVal - minVal || 1;

  const chartWidth = 700;
  const chartHeight = 250;

  const optPoints = points.map((p, idx) => {
    const x = (idx / (points.length - 1 || 1)) * chartWidth;
    const y = chartHeight - ((p.optimistic - minVal) / range) * (chartHeight - 20);
    return `${x},${y}`;
  });

  const basePoints = points.map((p, idx) => {
    const x = (idx / (points.length - 1 || 1)) * chartWidth;
    const y = chartHeight - ((p.base - minVal) / range) * (chartHeight - 20);
    return `${x},${y}`;
  });

  const consPoints = points.map((p, idx) => {
    const x = (idx / (points.length - 1 || 1)) * chartWidth;
    const y = chartHeight - ((p.conservative - minVal) / range) * (chartHeight - 20);
    return `${x},${y}`;
  });

  const finalPoint = points[points.length - 1];

  return (
    <div className="rounded-panel border border-panel-border bg-panel p-6 space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Net Worth Trajectory</h3>
          <p className="text-xs text-muted">
            Projected end value: Base {formatCurrency(finalPoint?.base || 0)} (Range: {formatCurrency(finalPoint?.conservative || 0)} to {formatCurrency(finalPoint?.optimistic || 0)})
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-medium">
          <span className="flex items-center gap-1.5 text-emerald-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Optimistic
          </span>
          <span className="flex items-center gap-1.5 text-accent">
            <span className="h-2 w-2 rounded-full bg-accent" /> Base
          </span>
          <span className="flex items-center gap-1.5 text-amber-500">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> Conservative
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full max-w-full">
          <polyline fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="3 3" points={optPoints.join(" ")} />
          <polyline fill="none" stroke="var(--accent)" strokeWidth="2.5" points={basePoints.join(" ")} />
          <polyline fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="3 3" points={consPoints.join(" ")} />
        </svg>
      </div>
    </div>
  );
}
