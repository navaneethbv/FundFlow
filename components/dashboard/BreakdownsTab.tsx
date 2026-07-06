import type { DashboardData } from "@/lib/dashboard";
import { formatCurrency } from "@/lib/format";
import BarList from "@/components/dashboard/BarList";
import Panel from "@/components/ui/Panel";

export default function BreakdownsTab({ data }: { data: DashboardData }) {
  const maxCard = Math.max(1, ...data.spendPerCard.map((i) => i.amount));
  const maxBank = Math.max(1, ...data.spendPerBank.map((i) => i.amount));

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Spend by card" eyebrow={formatCurrency(data.currentMonthExpenses)}>
        <BarList items={data.spendPerCard.map((i) => ({ label: i.name, amount: i.amount }))} max={maxCard} />
      </Panel>
      <Panel title="Spend by bank" eyebrow="This month">
        <BarList items={data.spendPerBank.map((i) => ({ label: i.name, amount: i.amount }))} max={maxBank} />
      </Panel>
    </div>
  );
}
