import Link from "next/link";
import { reportFiltersToSearchParams, type ReportFilters } from "@/lib/reports";
import { getAdjacentReportRange, getReportPresetRange, reportHref, type ReportFacet, type ReportFacets, type ReportPreset } from "@/lib/report-explorer";

const FIELD_CLASS = "min-h-11 w-full min-w-0 rounded-field border border-panel-border bg-background px-3 py-2 text-sm focus-visible:outline-2";
const BUTTON_CLASS = "min-h-11 self-end rounded-field bg-accent px-4 py-2 text-sm font-bold text-accent-foreground focus-visible:outline-2";
const LINK_CLASS = "inline-flex min-h-11 items-center rounded-field border border-panel-border px-3 py-2 text-sm font-semibold hover:bg-panel-hover focus-visible:outline-2";

/** Serialize the canonical state once; GET forms omit only fields they edit. */
export function ReportHiddenFields({ filters, omit }: Readonly<{ filters: ReportFilters; omit: readonly string[] }>) {
  return [...reportFiltersToSearchParams(filters)].filter(([name]) => !omit.includes(name)).map(([name, value], index) => (
    <input key={`${name}:${index}`} type="hidden" name={name} value={value} />
  ));
}

const PRESETS: readonly [ReportPreset, string][] = [
  ["this_month", "This month"], ["last_month", "Last month"],
  ["last_30_days", "Last 30 days"], ["last_90_days", "Last 90 days"],
  ["year_to_date", "Year to date"], ["prior_year", "Prior year"],
];

export function ReportDateShortcuts({ filters, today }: Readonly<{ filters: ReportFilters; today?: string }>) {
  return <div className="mt-4 space-y-3">
    {today && <nav aria-label="Report date presets" className="flex flex-wrap gap-2">
      {PRESETS.map(([preset, label]) => {
        const range = getReportPresetRange(preset, today);
        return range && <Link key={preset} href={reportHref(filters, range)} className={LINK_CLASS} aria-current={range.start === filters.start && range.end === filters.end ? "true" : undefined}>{label}</Link>;
      })}
    </nav>}
    <nav aria-label="Adjacent report periods" className="flex flex-wrap gap-2">
      {(["previous", "next"] as const).map((direction) => {
        const range = getAdjacentReportRange(filters, direction);
        return range && <Link key={direction} href={reportHref(filters, range)} className={LINK_CLASS}>{direction === "previous" ? "Previous period" : "Next period"}</Link>;
      })}
    </nav>
  </div>;
}

function selectedOptions(options: readonly ReportFacet[], selected: readonly string[]): ReportFacet[] {
  const combined = new Map(options.map((option) => [option.value.toLowerCase(), option]));
  for (const value of selected) {
    const existing = combined.get(value.toLowerCase());
    // Retain the saved value's casing and selections absent from this range.
    combined.set(value.toLowerCase(), { value, label: existing?.label ?? value });
  }
  return [...combined.values()];
}

export function reportFacetLabel(options: readonly ReportFacet[] | undefined, value: string): string {
  return options?.find((option) => option.value.toLowerCase() === value.toLowerCase())?.label ?? value;
}

export function ReportSelectionControls({ filters, facets }: Readonly<{ filters: ReportFilters; facets?: ReportFacets }>) {
  // URL transitions remount uncontrolled fields so clear/back restores the URL state.
  return <form key={reportFiltersToSearchParams(filters).toString()} method="get" action="/reports" aria-label="Report selections" className="mt-4 border-t border-panel-border pt-4">
    <ReportHiddenFields filters={filters} omit={["account", "category", "merchant"]} />
    <p id="report-selection-help" className="mb-3 text-xs text-muted">Select one or more options. Leave a list unselected to include all. Use Ctrl or Command to select multiple options with a keyboard.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      {([
        ["account", "Account", filters.accounts, facets?.accounts],
        ["category", "Category", filters.categories, facets?.categories],
        ["merchant", "Merchant", filters.merchants, facets?.merchants],
      ] as const).map(([name, label, selected, options]) => <div key={name} className="min-w-0 text-sm font-semibold">
        <label htmlFor={`report-${name}`} className="mb-1 block text-xs text-muted">{label}</label>
        <select id={`report-${name}`} name={name} multiple size={4} defaultValue={selected} aria-describedby="report-selection-help" className={FIELD_CLASS}>
          {selectedOptions(options ?? [], selected).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>)}
    </div>
    <button type="submit" className={`${BUTTON_CLASS} mt-3`}>Apply selections</button>
  </form>;
}

export function ReportAnalysisControls({ filters }: Readonly<{ filters: ReportFilters }>) {
  return <form key={reportFiltersToSearchParams(filters).toString()} method="get" action="/reports" aria-label="Report analysis settings" className="mt-4 grid gap-3 border-t border-panel-border pt-4 sm:grid-cols-[1fr_1fr_auto]">
    <ReportHiddenFields filters={filters} omit={["interval", "comparison"]} />
    <div className="min-w-0 text-sm font-semibold">
      <label htmlFor="report-interval" className="mb-1 block text-xs text-muted">Trend interval</label>
      <select id="report-interval" name="interval" defaultValue={filters.interval ?? "monthly"} className={FIELD_CLASS}>
        <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
      </select>
    </div>
    <div className="min-w-0 text-sm font-semibold">
      <label htmlFor="report-comparison" className="mb-1 block text-xs text-muted">Compare with</label>
      <select id="report-comparison" name="comparison" defaultValue={filters.comparison ?? "none"} className={FIELD_CLASS}>
        <option value="none">No comparison</option><option value="previous_period">Previous period</option><option value="previous_year">Previous year</option>
      </select>
    </div>
    <button type="submit" className={BUTTON_CLASS}>Apply analysis</button>
  </form>;
}
