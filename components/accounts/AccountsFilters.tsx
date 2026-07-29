import Select from "@/components/ui/Select";
import type { AccountGroupKey } from "@/lib/accounts-page";

export interface AccountsFilterValues {
  scope?: string;
  institution?: string;
  type?: AccountGroupKey;
  visibility?: "visible" | "hidden" | "all";
  owner?: string;
  range?: "30" | "90" | "all";
  summary?: "totals" | "percent";
}

export default function AccountsFilters({
  current,
  institutions,
  householdScope,
  ownerOptions,
}: Readonly<{
  current: AccountsFilterValues;
  institutions: string[];
  householdScope: boolean;
  ownerOptions: Array<{ value: string; label: string }>;
}>) {
  return (
    <form
      method="get"
      className="grid gap-3 rounded-card border border-panel-border bg-panel p-4 shadow-card sm:grid-cols-2 xl:grid-cols-6"
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
          <option value="all">All available</option>
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
        className="min-h-11 self-end rounded-field bg-accent-strong px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2"
      >
        Apply filters
      </button>
    </form>
  );
}
