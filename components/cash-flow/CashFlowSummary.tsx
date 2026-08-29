import Panel from "@/components/ui/Panel";
import type { PeriodCashFlow } from "@/lib/cash-flow";
import { formatCurrency } from "@/lib/format";

function formatPercent(value: number | null): string {
  // No income means there is no denominator, not a 0% rate.
  if (value === null) return "No income";
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function savingsRateColor(value: number | null): string | undefined {
  if (value === null) return undefined;
  return value >= 0 ? "var(--viz-pos)" : "var(--viz-neg)";
}

export default function CashFlowSummary({
  period,
  currency,
}: Readonly<{
  period: PeriodCashFlow | null;
  currency: string;
}>) {
  if (!period) {
    return (
      <Panel>
        <p className="text-sm text-muted">
          No selected-period totals are available.
        </p>
      </Panel>
    );
  }

  const metrics = [
    {
      label: "Income",
      value: formatCurrency(period.income, currency),
      color: "var(--viz-pos)",
    },
    {
      label: "Expenses",
      value: formatCurrency(period.expenses, currency),
      color: "var(--viz-neg)",
    },
    {
      label: "Savings",
      value: formatCurrency(period.savings, currency),
      color: period.savings >= 0 ? "var(--viz-pos)" : "var(--viz-neg)",
    },
    {
      label: "Savings rate",
      value: formatPercent(period.savingsRate),
      color: savingsRateColor(period.savingsRate),
    },
  ];

  return (
    <section aria-labelledby="cash-flow-summary-heading">
      <h2 id="cash-flow-summary-heading" className="eyebrow mb-3">
        {period.label}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Panel key={metric.label} className="min-w-0">
            <p className="eyebrow">{metric.label}</p>
            <p
              data-money
              className="metric-value mt-3 break-words tabular-nums text-[clamp(1.25rem,0.95rem+0.6vw,1.875rem)]"
              style={{ color: metric.color }}
            >
              {metric.value}
            </p>
          </Panel>
        ))}
      </div>
    </section>
  );
}
