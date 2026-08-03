import { dashboardUrl } from "@/lib/drilldown";
import { formatCurrency } from "@/lib/format";
import SegmentedControl from "@/components/ui/SegmentedControl";

/**
 * Household scope toggle (4.2/4.3): "Just mine" vs "Household" segmented
 * control plus the per-person spend attribution line when partner data is
 * present. Server-rendered — scope is a URL parameter, not client state.
 */
export default function ScopeChips({
  activeView,
  selectedMonth,
  selectedAccountId,
  selectedItemId,
  dashboardScope,
  spendPerPerson,
}: Readonly<{
  activeView: string;
  selectedMonth?: string;
  selectedAccountId?: string;
  selectedItemId?: string;
  dashboardScope: "mine" | "household";
  spendPerPerson: { mine: number; household: number } | null;
}>) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl
        ariaLabel="Financial scope"
        items={[
          {
            label: "Just mine",
            href: dashboardUrl({
              view: activeView,
              month: selectedMonth,
              accountId: selectedAccountId,
              itemId: selectedItemId,
              scope: undefined,
            }),
            active: dashboardScope === "mine",
          },
          {
            label: "Household",
            href: dashboardUrl({
              view: activeView,
              month: selectedMonth,
              accountId: selectedAccountId,
              itemId: selectedItemId,
              scope: "household",
            }),
            active: dashboardScope === "household",
          },
        ]}
      />
      {spendPerPerson && (
        <span className="text-xs font-semibold text-muted">
          You {formatCurrency(spendPerPerson.mine)} · household{" "}
          {formatCurrency(spendPerPerson.household)} this month
        </span>
      )}
    </div>
  );
}
