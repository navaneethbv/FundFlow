import type { ForecastAssumptions, ForecastDefaults } from "@/lib/forecasting";

const HORIZONS: { value: ForecastAssumptions["horizonMonths"]; label: string }[] = [
  { value: 12, label: "1 year" },
  { value: 60, label: "5 years" },
  { value: 120, label: "10 years" },
];

/**
 * A plain GET form: every assumption is a query param, so the whole page is
 * one shareable, back-button-correct URL and needs no client JS. Every
 * inferred default is shown as the input's own value, and a user can
 * override any of them by typing over it.
 */
export default function AssumptionsPanel({
  assumptions,
  defaults,
}: Readonly<{ assumptions: ForecastAssumptions; defaults: ForecastDefaults }>) {
  return (
    <form method="get" action="/forecasting" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-sm font-semibold">
        <span className="mb-1 block text-xs text-muted">
          Monthly savings {defaults.monthlySavings > 0 && "(from your last 6 months)"}
        </span>
        <input
          type="number"
          name="monthlySavings"
          defaultValue={assumptions.monthlySavings}
          className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
        />
      </label>
      <label className="text-sm font-semibold">
        <span className="mb-1 block text-xs text-muted">Annual investment return %</span>
        <input
          type="number"
          name="annualReturnPct"
          step="0.1"
          defaultValue={assumptions.annualReturnPct}
          className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
        />
      </label>
      <label className="text-sm font-semibold">
        <span className="mb-1 block text-xs text-muted">Annual cash yield %</span>
        <input
          type="number"
          name="annualCashYieldPct"
          step="0.1"
          defaultValue={assumptions.annualCashYieldPct}
          className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
        />
      </label>
      <label className="text-sm font-semibold">
        <span className="mb-1 block text-xs text-muted">
          Monthly debt payment {defaults.monthlyDebtPayment > 0 && "(from your last 6 months)"}
        </span>
        <input
          type="number"
          name="monthlyDebtPayment"
          defaultValue={assumptions.monthlyDebtPayment}
          className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
        />
      </label>
      <label className="text-sm font-semibold">
        <span className="mb-1 block text-xs text-muted">Horizon</span>
        <select
          name="horizon"
          defaultValue={assumptions.horizonMonths}
          className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
        >
          {HORIZONS.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </select>
      </label>
      <div className="sm:col-span-2 lg:col-span-5">
        <button
          type="submit"
          className="min-h-11 rounded-field bg-accent-strong px-4 text-sm font-semibold text-white shadow-sm hover:brightness-110"
        >
          Update projection
        </button>
      </div>
    </form>
  );
}
