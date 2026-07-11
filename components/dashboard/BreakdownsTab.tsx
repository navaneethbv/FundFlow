import type { DashboardData } from "@/lib/dashboard";
import { dashboardUrl } from "@/lib/drilldown";
import { formatCurrency } from "@/lib/format";
import BarList from "@/components/dashboard/BarList";
import Panel from "@/components/ui/Panel";
import type { DrillLinkParams } from "@/components/dashboard/CategoryDrilldownPanel";

export default function BreakdownsTab({
  data,
  linkParams,
}: {
  data: DashboardData;
  linkParams: DrillLinkParams;
}) {
  const maxCard = Math.max(1, ...data.spendPerCard.map((i) => i.amount));
  const maxBank = Math.max(1, ...data.spendPerBank.map((i) => i.amount));

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Spend by card" eyebrow={formatCurrency(data.currentMonthExpenses)}>
        <BarList
          items={data.spendPerCard.map((i) => ({
            label: i.name,
            amount: i.amount,
            href: dashboardUrl({ ...linkParams, accountId: i.accountId }),
          }))}
          max={maxCard}
        />
      </Panel>
      <Panel title="Spend by bank" eyebrow="This month">
        <BarList
          items={data.spendPerBank.map((i) => ({
            label: i.name,
            amount: i.amount,
            href: i.itemId ? dashboardUrl({ ...linkParams, itemId: i.itemId }) : undefined,
          }))}
          max={maxBank}
        />
      </Panel>
    </div>
  );
}
