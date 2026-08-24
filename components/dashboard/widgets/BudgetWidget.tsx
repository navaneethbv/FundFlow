import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import DropdownButton from "@/components/ui/DropdownButton";
import ProgressBar, { type ProgressBarTone } from "@/components/ui/ProgressBar";
import { formatCurrency } from "@/lib/format";
import type { DashboardBudgetGroup } from "@/lib/dashboard-budget-groups";

const STATUS_TONE: Record<string, ProgressBarTone> = {
  over: "danger",
  "at-risk": "warning",
  "on-track": "success",
};

export default function BudgetWidget({
  groups,
  currency,
  error = null,
}: Readonly<{
  groups: DashboardBudgetGroup[];
  currency: string;
  error?: string | null;
}>) {
  const totalSpent = groups.reduce((sum, group) => sum + group.spent, 0);

  return (
    <WidgetShell
      title="Budget"
      value={groups.length > 0 ? `${formatCurrency(totalSpent, currency)} spent` : undefined}
      error={error}
      empty={
        groups.length === 0
          ? "No budgets set. Add one to track planned against actual."
          : null
      }
      action={<DropdownButton label="This month" items={[{ label: "Open Budget", href: "/budget" }]} />}
    >
      <ul className="space-y-3">
        {groups.map((group) => {
          let pct = 0;
          if (group.monthlyLimit > 0) {
            pct = Math.min(100, Math.round((group.spent / group.monthlyLimit) * 100));
          } else if (group.spent > 0) {
            pct = 100;
          }
          return (
            <li key={group.key}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate">{group.label}</span>
                <span className="tabular-nums text-muted" data-money>
                  {formatCurrency(group.spent, currency)} /{" "}
                  {formatCurrency(group.monthlyLimit, currency)}
                </span>
              </div>
              <ProgressBar
                className="mt-1"
                size="sm"
                percent={pct}
                tone={STATUS_TONE[group.status] ?? "accent"}
                label={`${group.label}: ${pct}% of budget used, ${group.status}`}
              />
            </li>
          );
        })}
      </ul>
    </WidgetShell>
  );
}
