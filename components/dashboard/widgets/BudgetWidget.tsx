import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import ButtonLink from "@/components/ui/ButtonLink";
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
      action={<ButtonLink href="/budget" variant="ghost" size="sm">Open Budget</ButtonLink>}
    >
      <ul className="divide-y divide-panel-border">
        {groups.map((group) => {
          let pct = 0;
          if (group.monthlyLimit > 0) {
            pct = Math.min(100, Math.round((group.spent / group.monthlyLimit) * 100));
          } else if (group.spent > 0) {
            pct = 100;
          }
          return (
            <li key={group.key} className="py-4 first:pt-0 last:pb-0">
              <div className="flex justify-between gap-3 text-base">
                <span className="truncate">{group.label}</span>
                <span className="tabular-nums text-muted" data-money>
                  {formatCurrency(group.monthlyLimit, currency)} planned
                </span>
              </div>
              <ProgressBar
                className="mt-3"
                size="md"
                percent={pct}
                tone={STATUS_TONE[group.status] ?? "accent"}
                label={`${group.label}: ${pct}% of budget used, ${group.status}`}
              />
              <div className="mt-2 flex justify-between gap-3 text-sm">
                <span data-money>{formatCurrency(group.spent, currency)} spent</span>
                <span data-money className={group.spent > group.monthlyLimit ? "text-danger" : "text-success"}>{formatCurrency(group.remaining, currency)} remaining</span>
              </div>
            </li>
          );
        })}
      </ul>
    </WidgetShell>
  );
}
