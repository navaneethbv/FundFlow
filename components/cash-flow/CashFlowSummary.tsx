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

function savingsRateTone(value: number | null): string {
  if (value === null) return "var(--viz-ink)";
  return value >= 0 ? "var(--viz-good)" : "var(--viz-bad)";
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
      tone: "var(--viz-good)",
    },
    {
      label: "Expenses",
      value: formatCurrency(period.expenses, currency),
      tone: "var(--viz-ink)",
    },
    {
      label: "Savings",
      value: formatCurrency(period.savings, currency),
      tone:
        period.savings >= 0 ? "var(--viz-good)" : "var(--viz-bad)",
    },
    {
      label: "Savings rate",
      value: formatPercent(period.savingsRate),
      tone: savingsRateTone(period.savingsRate),
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
              className="metric-value mt-3 truncate text-2xl sm:text-3xl"
              style={{ color: metric.tone }}
            >
              {metric.value}
            </p>
          </Panel>
        ))}
      </div>
    </section>
  );
}
