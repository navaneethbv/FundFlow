"use client";

import type { ForecastAssumptions } from "@/lib/forecasting";

export default function AssumptionsPanel({
  assumptions,
  onChange,
}: Readonly<{
  assumptions: ForecastAssumptions;
  onChange: (updated: ForecastAssumptions) => void;
}>) {
  return (
    <div className="rounded-panel border border-panel-border bg-panel p-5 space-y-4">
      <h3 className="font-semibold text-foreground">Forecast Assumptions</h3>

      <div className="grid gap-4 sm:grid-cols-3 text-xs">
        <div>
          <label className="block font-medium text-muted mb-1">Monthly Savings ($)</label>
          <input
            type="number"
            value={assumptions.monthlySavings}
            onChange={(e) => onChange({ ...assumptions, monthlySavings: Number(e.target.value) })}
            className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
          />
        </div>

        <div>
          <label className="block font-medium text-muted mb-1">Expected Return (% APR)</label>
          <input
            type="number"
            value={assumptions.annualReturnPct}
            onChange={(e) => onChange({ ...assumptions, annualReturnPct: Number(e.target.value) })}
            className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
          />
        </div>

        <div>
          <label className="block font-medium text-muted mb-1">Forecast Horizon</label>
          <select
            value={assumptions.horizonMonths}
            onChange={(e) => onChange({ ...assumptions, horizonMonths: Number(e.target.value) as 12 | 60 | 120 })}
            className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
          >
            <option value={12}>1 Year (12 Months)</option>
            <option value={60}>5 Years (60 Months)</option>
            <option value={120}>10 Years (120 Months)</option>
          </select>
        </div>
      </div>
    </div>
  );
}
