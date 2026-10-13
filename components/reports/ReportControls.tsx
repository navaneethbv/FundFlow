import Link from "next/link";
import SegmentedControl from "@/components/ui/SegmentedControl";
import {
  reportFiltersToSearchParams,
  type ReportDirection,
  type ReportFilters,
  type ReportMode,
  type ReportSort,
  type ReportTab,
} from "@/lib/reports";
import type { BreakdownDimension } from "@/lib/cash-flow";
import { reportHref, type ReportFacets } from "@/lib/report-explorer";
import { ReportAnalysisControls, ReportDateShortcuts, ReportHiddenFields, ReportSelectionControls, reportFacetLabel } from "./ReportExplorationControls";

export { reportHref } from "@/lib/report-explorer";

/**
 * Every control here is either a link or a plain GET form, so tab switches,
 * range changes, and scope changes are pure URL navigation with no client JS.
 * That keeps the whole Reports surface server-rendered (CSP-friendly) and makes
 * any report state shareable and back-button-correct. Sorting is links too, so
 * the sort + direction live in the URL and a change intentionally drops the
 * `page` param, which resets pagination to page one.
 */

export const TAB_LABELS: Record<ReportTab, string> = {
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

const SORT_LABELS: Record<ReportSort, string> = {
  date: "Date",
  merchant: "Merchant",
  amount: "Amount",
};

const DIRECTION_LABELS: Record<ReportDirection, string> = {
  asc: "Ascending",
  desc: "Descending",
};

export default function ReportControls({
  filters,
  householdId,
  today,
  facets,
}: Readonly<{ filters: ReportFilters; householdId?: string; today?: string; facets?: ReportFacets }>) {
  return (
    <section
      aria-label="Report controls"
      className="rounded-card border border-panel-border bg-panel p-4 shadow-card"
    >
      <div className="grid gap-4 xl:grid-cols-[auto_1fr] xl:items-end">
        <fieldset>
          <legend className="eyebrow mb-2">View</legend>
          <SegmentedControl
            ariaLabel="View"
            items={(Object.keys(MODE_LABELS) as ReportMode[]).map((mode) => ({
              label: MODE_LABELS[mode],
              href: reportHref(filters, { mode }),
              active: filters.mode === mode,
            }))}
          />
        </fieldset>

        <form
          key={reportFiltersToSearchParams(filters).toString()}
          method="get"
          action="/reports"
          aria-label="Report dates"
          className="grid gap-3 sm:grid-cols-[repeat(2,minmax(9rem,1fr))_auto]"
        >
          <ReportHiddenFields filters={filters} omit={["start", "end"]} />

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

      <ReportDateShortcuts filters={filters} today={today} />
      <ReportAnalysisControls filters={filters} />
      <ReportSelectionControls filters={filters} facets={facets} />

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-panel-border pt-4">
        <fieldset>
          <legend className="eyebrow mb-1">Sort by</legend>
          <SegmentedControl
            ariaLabel="Sort report transactions by"
            items={(Object.keys(SORT_LABELS) as ReportSort[]).map((sort) => ({
              label: SORT_LABELS[sort],
              href: reportHref(filters, { sort }),
              active: filters.sort === sort,
            }))}
          />
        </fieldset>

        <fieldset>
          <legend className="eyebrow mb-1">Direction</legend>
          <SegmentedControl
            ariaLabel="Sort direction"
            items={(Object.keys(DIRECTION_LABELS) as ReportDirection[]).map(
              (direction) => ({
                label: DIRECTION_LABELS[direction],
                href: reportHref(filters, { direction }),
                active: filters.direction === direction,
              }),
            )}
          />
        </fieldset>

        <fieldset>
          <legend className="eyebrow mb-1">Break down by</legend>
          <SegmentedControl
            ariaLabel="Break down by"
            items={(Object.keys(DIMENSION_LABELS) as BreakdownDimension[]).map(
              (dimension) => ({
                label: DIMENSION_LABELS[dimension],
                href: reportHref(filters, { dimension }),
                active: filters.dimension === dimension,
              }),
            )}
          />
        </fieldset>

        <fieldset>
          <legend className="eyebrow mb-1">Pending</legend>
          <SegmentedControl
            ariaLabel="Pending"
            items={[
              {
                label: "Included",
                href: reportHref(filters, { excludePending: false }),
                active: !filters.excludePending,
              },
              {
                label: "Excluded",
                href: reportHref(filters, { excludePending: true }),
                active: filters.excludePending,
              },
            ]}
          />
        </fieldset>

        {householdId && (
          <fieldset>
            <legend className="eyebrow mb-1">Scope</legend>
            <SegmentedControl
              ariaLabel="Financial scope"
              items={[
                {
                  label: "Just mine",
                  href: reportHref(filters, { scope: null }),
                  active: !filters.scope,
                },
                {
                  label: "Household",
                  href: reportHref(filters, { scope: householdId }),
                  active: filters.scope === householdId,
                },
              ]}
            />
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
                <span>{reportFacetLabel(facets?.[key], value)}</span>
                <span aria-hidden>×</span>
                <span className="sr-only">Remove this filter</span>
              </Link>
            )),
          )}
          <Link href={reportHref(filters, { accounts: [], categories: [], merchants: [] })} className="inline-flex min-h-11 items-center rounded-field px-3 py-1 text-sm font-semibold text-accent hover:bg-panel-hover focus-visible:outline-2">Clear selections</Link>
        </div>
      )}
    </section>
  );
}
