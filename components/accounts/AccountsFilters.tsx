import Select from "@/components/ui/Select";
import type { AccountGroupKey } from "@/lib/accounts-page";

export interface AccountsFilterValues {
  scope?: string;
  institution?: string;
  type?: AccountGroupKey;
  visibility?: "visible" | "hidden" | "all";
  owner?: string;
  range?: "30" | "90" | "365";
  summary?: "totals" | "percent";
}

function hasActiveFilter(current: AccountsFilterValues): boolean {
  return Boolean(
    current.institution ||
      current.type ||
      (current.visibility && current.visibility !== "visible") ||
      current.owner ||
      (current.range && current.range !== "30"),
  );
}

/**
 * The GET filter form behind Monarch's "Filters" white pill — a collapsible
 * `<details>` rather than the always-open form this used to be, auto-open
 * when a filter is already active so switching accounts pages never hides
 * *why* the list looks filtered. `children` lets the page nest
 * `AccountPreferences` in the same panel — Monarch's Filters entry point is
 * also where account visibility/order lives, rather than a separate
 * always-visible block of its own further down the page.
 */
export default function AccountsFilters({
  current,
  institutions,
  householdScope,
  ownerOptions,
  children,
}: Readonly<{
  current: AccountsFilterValues;
  institutions: string[];
  householdScope: boolean;
  ownerOptions: Array<{ value: string; label: string }>;
  children?: React.ReactNode;
}>) {
  return (
    <details
      open={hasActiveFilter(current)}
      className="overflow-hidden rounded-card border border-panel-border bg-panel shadow-card"
    >
      <summary className="inline-flex min-h-11 w-full cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold focus-visible:outline-2">
        Filters
      </summary>
      <div className="space-y-4 border-t border-panel-border p-4">
        <form
          method="get"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"
        >
          {current.scope && (
            <input type="hidden" name="scope" value={current.scope} />
          )}
          <label className="space-y-1 text-xs font-semibold text-muted">
            Institution
            <Select name="institution" defaultValue={current.institution ?? ""}>
              <option value="">All institutions</option>
              {institutions.map((institution) => (
                <option key={institution} value={institution}>
                  {institution}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-muted">
            Account type
            <Select name="type" defaultValue={current.type ?? ""}>
              <option value="">All types</option>
              <option value="cash">Cash</option>
              <option value="credit">Credit cards</option>
              <option value="investment">Investments</option>
              <option value="loan">Loans</option>
              <option value="other">Other</option>
            </Select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-muted">
            Visibility
            <Select
              name="visibility"
              defaultValue={current.visibility ?? "visible"}
            >
              <option value="visible">Visible</option>
              <option value="hidden">Hidden</option>
              <option value="all">All</option>
            </Select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-muted">
            History
            <Select name="range" defaultValue={current.range ?? "30"}>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">12 months</option>
            </Select>
          </label>
          {householdScope && (
            <label className="space-y-1 text-xs font-semibold text-muted">
              Owner
              <Select name="owner" defaultValue={current.owner ?? ""}>
                <option value="">Everyone</option>
                {ownerOptions.map((owner) => (
                  <option key={owner.value} value={owner.value}>
                    {owner.label}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <button
            type="submit"
            className="min-h-11 self-end rounded-field bg-accent-strong px-4 py-2 text-sm font-semibold text-accent-strong-foreground focus-visible:outline-2"
          >
            Apply filters
          </button>
        </form>
        {children}
      </div>
    </details>
  );
}
