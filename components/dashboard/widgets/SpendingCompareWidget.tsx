import Link from "next/link";
import CumulativeCompareChart from "@/components/charts/CumulativeCompareChart";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import type { CumulativeSpendDay } from "@/lib/dashboard";

export default function SpendingCompareWidget({
  days,
  monthLabel,
  previousMonthLabel,
  error = null,
}: Readonly<{
  days: CumulativeSpendDay[];
  monthLabel: string;
  previousMonthLabel: string;
  error?: string | null;
}>) {
  const hasSpend = days.some(
    (row) => (row.thisMonth ?? 0) > 0 || (row.lastMonth ?? 0) > 0,
  );
  return (
    <WidgetShell
      title="Spending vs last month"
      hint="Cumulative"
      error={error}
      empty={hasSpend ? null : "No spending recorded in either month yet."}
      action={
        <Link
          href="/cash-flow"
          className="text-sm font-semibold text-accent hover:underline"
        >
          Cash Flow
        </Link>
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
