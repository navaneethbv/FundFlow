import DivergingColumns from "@/components/charts/DivergingColumns";
import type { PeriodCashFlow } from "@/lib/cash-flow";

function compactCurrency(value: number, currency: string): string {
  if (!/^[A-Z]{3}$/.test(currency)) {
    return value.toLocaleString("en-US", {
      maximumFractionDigits: 1,
      notation: "compact",
    });
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 1,
      notation: "compact",
    }).format(value);
  } catch {
    return value.toLocaleString("en-US", {
      maximumFractionDigits: 1,
      notation: "compact",
    });
  }
}

/**
 * Per-period savings, NOT a running total.
 *
 * A cumulative line belongs to a different scale than the per-period bars it
 * would sit on: over 12-24 periods the running total dwarfs any single
 * period's income, and because the shared axis is sized to the largest arm,
 * every bar collapses to a few unreadable pixels. Net savings per period is
 * the same unit and magnitude as the bars, so one axis is honest.
 */
function periodSavings(periods: PeriodCashFlow[]): number[] {
  return periods.map((period) => period.savings);
}

export default function PeriodBars({
  periods,
  currency,
  links,
}: Readonly<{
  periods: PeriodCashFlow[];
  currency: string;
  links?: (string | undefined)[];
}>) {
  return (
    <DivergingColumns
      labels={periods.map((period) => period.label)}
      up={periods.map((period) => period.income)}
      down={periods.map((period) => period.expenses)}
      upName="Income"
      downName="Expenses"
      line={{
        name: "Net savings",
        values: periodSavings(periods),
      }}
      links={links}
      valueFormatter={(value) => compactCurrency(value, currency)}
    />
  );
}
