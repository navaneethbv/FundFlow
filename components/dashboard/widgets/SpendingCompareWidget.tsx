import CumulativeCompareChart from "@/components/charts/CumulativeCompareChart";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import DropdownButton from "@/components/ui/DropdownButton";
import { formatCurrency } from "@/lib/format";
import type { CumulativeSpendDay } from "@/lib/dashboard";

export default function SpendingCompareWidget({
  days,
  monthLabel,
  previousMonthLabel,
  currency = "USD",
  error = null,
}: Readonly<{
  days: CumulativeSpendDay[];
  monthLabel: string;
  previousMonthLabel: string;
  currency?: string;
  error?: string | null;
}>) {
  const hasSpend = days.some(
    (row) => (row.thisMonth ?? 0) > 0 || (row.lastMonth ?? 0) > 0,
  );
  const runningTotal = [...days].reverse().find((row) => row.thisMonth !== null)?.thisMonth ?? null;

  return (
    <WidgetShell
      title="Spending"
      value={runningTotal !== null ? `${formatCurrency(runningTotal, currency)} this month` : undefined}
      error={error}
      empty={hasSpend ? null : "No spending recorded in either month yet."}
      action={
        <DropdownButton
          label="This month vs. last month"
          items={[{ label: "Open Cash Flow", href: "/cash-flow" }]}
        />
      }
    >
      <CumulativeCompareChart
        days={days}
        monthLabel={monthLabel}
        previousMonthLabel={previousMonthLabel}
      />
    </WidgetShell>
  );
}
