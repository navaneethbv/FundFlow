import Link from "next/link";
import { cn } from "@/lib/cn";

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

function ControlLink({
  href,
  active,
  children,
}: Readonly<{
  href: string;
  active: boolean;
  children: React.ReactNode;
}>) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-field px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2",
        active
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-panel-hover hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
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
          <div className="flex flex-wrap gap-1">
            {(["monthly", "quarterly", "yearly"] as const).map((period) => (
              <ControlLink
                key={period}
                href={cashFlowHref(current, {
                  period,
                  selected: undefined,
                })}
                active={current.period === period}
              >
                {period[0]!.toUpperCase() + period.slice(1)}
              </ControlLink>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="eyebrow mb-2">Break down by</legend>
          <div className="flex flex-wrap gap-1">
            {(["category", "group", "merchant"] as const).map(
              (dimension) => (
                <ControlLink
                  key={dimension}
                  href={cashFlowHref(current, { dimension })}
                  active={current.dimension === dimension}
                >
                  {dimension[0]!.toUpperCase() + dimension.slice(1)}
                </ControlLink>
              ),
            )}
          </div>
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
              <div className="flex gap-1">
                <ControlLink
                  href={cashFlowHref(current, { scope: undefined })}
                  active={!current.scope}
                >
                  Just mine
                </ControlLink>
                <ControlLink
                  href={cashFlowHref(current, { scope: householdId })}
                  active={current.scope === householdId}
                >
                  Household
                </ControlLink>
              </div>
            </fieldset>
          )}

          {currencies.length > 1 && (
            <fieldset>
              <legend className="eyebrow mb-1">Currency</legend>
              <div className="flex flex-wrap gap-1">
                {currencies.map((currency) => (
                  <ControlLink
                    key={currency}
                    href={cashFlowHref(current, { currency })}
                    active={current.currency === currency}
                  >
                    {currency}
                  </ControlLink>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}
