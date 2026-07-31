import Link from "next/link";
import { cn } from "@/lib/cn";
import {
  reportFiltersToSearchParams,
  type ReportFilters,
  type ReportMode,
  type ReportTab,
} from "@/lib/reports";
import type { BreakdownDimension } from "@/lib/cash-flow";

/**
 * Every control here is either a link or a plain GET form, so tab switches,
 * range changes, and scope changes are pure URL navigation with no client JS.
 * That keeps the whole Reports surface server-rendered (CSP-friendly) and makes
 * any report state shareable and back-button-correct.
 */

const TAB_LABELS: Record<ReportTab, string> = {
  cash_flow: "Cash Flow",
  spending: "Spending",
  income: "Income",
};

const MODE_LABELS: Record<ReportMode, string> = {
  breakdown: "Breakdown",
  trends: "Trends",
};

const DIMENSION_LABELS: Record<BreakdownDimension, string> = {
  category: "Category",
  group: "Group",
  merchant: "Merchant",
};

export function reportHref(
  filters: ReportFilters,
  patch: Partial<ReportFilters> = {},
): string {
  return `/reports?${reportFiltersToSearchParams({ ...filters, ...patch }).toString()}`;
}

function ControlLink({
  href,
  active,
  children,
}: Readonly<{ href: string; active: boolean; children: React.ReactNode }>) {
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

export default function ReportControls({
  filters,
  householdId,
}: Readonly<{ filters: ReportFilters; householdId?: string }>) {
  return (
    <section
      aria-label="Report controls"
      className="rounded-card border border-panel-border bg-panel p-4 shadow-card"
    >
      <div className="grid gap-4 xl:grid-cols-[auto_auto_1fr] xl:items-end">
        <fieldset>
          <legend className="eyebrow mb-2">Report</legend>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(TAB_LABELS) as ReportTab[]).map((tab) => (
              <ControlLink
                key={tab}
                href={reportHref(filters, { tab })}
                active={filters.tab === tab}
              >
                {TAB_LABELS[tab]}
              </ControlLink>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="eyebrow mb-2">View</legend>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(MODE_LABELS) as ReportMode[]).map((mode) => (
              <ControlLink
                key={mode}
                href={reportHref(filters, { mode })}
                active={filters.mode === mode}
              >
                {MODE_LABELS[mode]}
              </ControlLink>
            ))}
          </div>
        </fieldset>

        <form
          method="get"
          action="/reports"
          className="grid gap-3 sm:grid-cols-[repeat(2,minmax(9rem,1fr))_auto]"
        >
          <input type="hidden" name="tab" value={filters.tab} />
          <input type="hidden" name="mode" value={filters.mode} />
          <input type="hidden" name="dimension" value={filters.dimension} />
          <input
            type="hidden"
            name="pending"
            value={filters.excludePending ? "exclude" : "include"}
          />
          {filters.scope && (
            <input type="hidden" name="scope" value={filters.scope} />
          )}
          {filters.accounts.map((account) => (
            <input key={account} type="hidden" name="account" value={account} />
          ))}
          {filters.merchants.map((merchant) => (
            <input key={merchant} type="hidden" name="merchant" value={merchant} />
          ))}
          {filters.categories.map((category) => (
            <input key={category} type="hidden" name="category" value={category} />
          ))}

          <label className="text-sm font-semibold">
            <span className="mb-1 block text-xs text-muted">From</span>
            <input
              type="date"
              name="start"
              defaultValue={filters.start}
              className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
            />
          </label>
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-xs text-muted">To</span>
            <input
              type="date"
              name="end"
              defaultValue={filters.end}
              className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
            />
          </label>
          <button
            type="submit"
            className="min-h-11 self-end rounded-field bg-accent px-4 py-2 text-sm font-bold text-accent-foreground focus-visible:outline-2"
          >
            Apply
          </button>
        </form>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-panel-border pt-4">
        <fieldset>
          <legend className="eyebrow mb-1">Break down by</legend>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(DIMENSION_LABELS) as BreakdownDimension[]).map(
              (dimension) => (
                <ControlLink
                  key={dimension}
                  href={reportHref(filters, { dimension })}
                  active={filters.dimension === dimension}
                >
                  {DIMENSION_LABELS[dimension]}
                </ControlLink>
              ),
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="eyebrow mb-1">Pending</legend>
          <div className="flex gap-1">
            <ControlLink
              href={reportHref(filters, { excludePending: false })}
              active={!filters.excludePending}
            >
              Included
            </ControlLink>
            <ControlLink
              href={reportHref(filters, { excludePending: true })}
              active={filters.excludePending}
            >
              Excluded
            </ControlLink>
          </div>
        </fieldset>

        {householdId && (
          <fieldset>
            <legend className="eyebrow mb-1">Scope</legend>
            <div className="flex gap-1">
              <ControlLink
                href={reportHref(filters, { scope: null })}
                active={!filters.scope}
              >
                Just mine
              </ControlLink>
              <ControlLink
                href={reportHref(filters, { scope: householdId })}
                active={filters.scope === householdId}
              >
                Household
              </ControlLink>
            </div>
          </fieldset>
        )}
      </div>

      {(filters.accounts.length > 0 ||
        filters.merchants.length > 0 ||
        filters.categories.length > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-panel-border pt-4">
          <span className="eyebrow">Filters</span>
          {(
            [
              ["accounts", filters.accounts],
              ["merchants", filters.merchants],
              ["categories", filters.categories],
            ] as const
          ).flatMap(([key, values]) =>
            values.map((value) => (
              <Link
                key={`${key}:${value}`}
                href={reportHref(filters, {
                  [key]: values.filter((entry) => entry !== value),
                } as Partial<ReportFilters>)}
                className="inline-flex min-h-11 items-center gap-1 rounded-field bg-accent-soft px-3 py-1 text-sm font-semibold text-accent focus-visible:outline-2"
              >
                <span>{value}</span>
                <span aria-hidden>×</span>
                <span className="sr-only">Remove this filter</span>
              </Link>
            )),
          )}
        </div>
      )}
    </section>
  );
}
