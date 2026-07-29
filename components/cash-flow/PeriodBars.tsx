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

function cumulativeSavings(periods: PeriodCashFlow[]): number[] {
  let total = 0;
  return periods.map((period) => {
    total += period.savings;
    return Math.round(total * 100) / 100;
  });
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
        name: "Cumulative savings",
        values: cumulativeSavings(periods),
      }}
      links={links}
      valueFormatter={(value) => compactCurrency(value, currency)}
    />
  );
}
