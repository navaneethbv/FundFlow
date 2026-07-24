import { dashboardUrl } from "@/lib/drilldown";
import { formatCurrency } from "@/lib/format";

/**
 * Household scope toggle (4.2/4.3): "Just mine" vs "Household" link chips
 * plus the per-person spend attribution line when partner data is present.
 * Server-rendered — scope is a URL parameter, not client state.
 */
export default function ScopeChips({
  activeView,
  selectedMonth,
  selectedAccountId,
  selectedItemId,
  dashboardScope,
  spendPerPerson,
}: {
  activeView: string;
  selectedMonth?: string;
  selectedAccountId?: string;
  selectedItemId?: string;
  dashboardScope: "mine" | "household";
  spendPerPerson: { mine: number; household: number } | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
      {(
        [
          { label: "Just mine", scope: undefined, active: dashboardScope === "mine" },
          { label: "Household", scope: "household", active: dashboardScope === "household" },
        ] as const
      ).map((option) => (
        <a
          key={option.label}
          href={dashboardUrl({
            view: activeView,
            month: selectedMonth,
            accountId: selectedAccountId,
            itemId: selectedItemId,
            scope: option.scope,
          })}
          aria-current={option.active ? "true" : undefined}
          className={
            option.active
              ? "rounded-field bg-accent-soft px-2.5 py-1 text-accent"
              : "rounded-field px-2.5 py-1 text-muted transition-colors hover:bg-panel-hover hover:text-foreground"
          }
        >
          {option.label}
        </a>
      ))}
      {spendPerPerson && (
        <span className="ml-1 text-muted">
          You {formatCurrency(spendPerPerson.mine)} · household{" "}
          {formatCurrency(spendPerPerson.household)} this month
        </span>
      )}
    </div>
  );
}
