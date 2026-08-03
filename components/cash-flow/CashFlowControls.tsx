import SegmentedControl from "@/components/ui/SegmentedControl";

export interface CashFlowControlValues {
  period: "monthly" | "quarterly" | "yearly";
  range: "6" | "12" | "24";
  selected?: string;
  dimension: "category" | "group" | "merchant";
  scope?: string;
  currency?: string;
}

type CashFlowControlPatch = Partial<
  Record<keyof CashFlowControlValues, string | undefined>
>;

function cashFlowHref(
  current: CashFlowControlValues,
  patch: CashFlowControlPatch,
): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const key of [
    "period",
    "range",
    "selected",
    "dimension",
    "scope",
    "currency",
  ] as const) {
    const value = next[key];
    if (value) params.set(key, value);
  }
  return `/cash-flow?${params.toString()}`;
}

export default function CashFlowControls({
  current,
  periods,
  currencies,
  householdId,
}: Readonly<{
  current: CashFlowControlValues;
  periods: Array<{ key: string; label: string }>;
  currencies: string[];
  householdId?: string;
}>) {
  return (
    <section
      aria-label="Cash Flow controls"
      className="rounded-card border border-panel-border bg-panel p-4 shadow-card"
    >
      <div className="grid gap-4 xl:grid-cols-[auto_auto_1fr] xl:items-end">
        <fieldset>
          <legend className="eyebrow mb-2">Period</legend>
          <SegmentedControl
            ariaLabel="Period"
            items={(["monthly", "quarterly", "yearly"] as const).map((period) => ({
              label: period[0]!.toUpperCase() + period.slice(1),
              href: cashFlowHref(current, { period, selected: undefined }),
              active: current.period === period,
            }))}
          />
        </fieldset>

        <fieldset>
          <legend className="eyebrow mb-2">Break down by</legend>
          <SegmentedControl
            ariaLabel="Break down by"
            items={(["category", "group", "merchant"] as const).map((dimension) => ({
              label: dimension[0]!.toUpperCase() + dimension.slice(1),
              href: cashFlowHref(current, { dimension }),
              active: current.dimension === dimension,
            }))}
          />
        </fieldset>

        <form
          method="get"
          action="/cash-flow"
          className="grid gap-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(10rem,1fr)_auto]"
        >
          <input type="hidden" name="period" value={current.period} />
          <input type="hidden" name="dimension" value={current.dimension} />
          {current.scope && (
            <input type="hidden" name="scope" value={current.scope} />
          )}
          {current.currency && (
            <input type="hidden" name="currency" value={current.currency} />
          )}
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-xs text-muted">Window</span>
            <select
              name="range"
              defaultValue={current.range}
              className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
            >
              <option value="6">6 months</option>
              <option value="12">12 months</option>
              <option value="24">24 months</option>
            </select>
          </label>
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-xs text-muted">
              Selected period
            </span>
            <select
              name="selected"
              defaultValue={current.selected}
              className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
            >
              {periods.map((period) => (
                <option key={period.key} value={period.key}>
                  {period.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="min-h-11 self-end rounded-field bg-accent px-4 py-2 text-sm font-bold text-accent-foreground focus-visible:outline-2"
          >
            Apply
          </button>
        </form>
      </div>

      {(householdId || currencies.length > 1) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-panel-border pt-4">
          {householdId && (
            <fieldset>
              <legend className="sr-only">Scope</legend>
              <SegmentedControl
                ariaLabel="Financial scope"
                items={[
                  {
                    label: "Just mine",
                    href: cashFlowHref(current, { scope: undefined }),
                    active: !current.scope,
                  },
                  {
                    label: "Household",
                    href: cashFlowHref(current, { scope: householdId }),
                    active: current.scope === householdId,
                  },
                ]}
              />
            </fieldset>
          )}

          {currencies.length > 1 && (
            <fieldset>
              <legend className="eyebrow mb-1">Currency</legend>
              <SegmentedControl
                ariaLabel="Currency"
                items={currencies.map((currency) => ({
                  label: currency,
                  href: cashFlowHref(current, { currency }),
                  active: current.currency === currency,
                }))}
              />
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}
