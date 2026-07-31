import { formatCurrency } from "@/lib/format";
import type { BudgetPageData } from "@/lib/budget-page";

export type BudgetSummaryTab = "summary" | "income" | "expenses";

export default function BudgetSummary({
  data,
  currency,
  tab = "summary",
}: Readonly<{
  data: BudgetPageData;
  currency: string;
  tab?: BudgetSummaryTab;
}>) {
  const cards =
    tab === "income"
      ? [
          ["Planned Income", data.totalIncome.planned],
          ["Actual Income", data.totalIncome.actual],
        ]
      : tab === "expenses"
        ? [
            ["Planned Expenses", data.totalExpenses.planned],
            ["Actual Expenses", data.totalExpenses.actual],
            ["Expense Remaining", data.totalExpenses.remaining],
          ]
        : [
            ["Planned Income", data.totalIncome.planned],
            ["Planned Expenses", data.totalExpenses.planned],
            ["Left to Budget", data.leftToBudget],
            ["Monthly Sinking Funds", data.sinkingFundsTotal],
          ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([label, value]) => (
        <div
          key={String(label)}
          className="rounded-card border border-panel-border bg-panel p-4 shadow-card"
        >
          <p className="text-xs font-medium text-muted">{label}</p>
          <p
            data-money
            className={`mt-1 text-2xl font-bold ${
              label === "Left to Budget" && Number(value) < 0
                ? "text-danger"
                : "text-foreground"
            }`}
          >
            {formatCurrency(Number(value), currency)}
          </p>
        </div>
      ))}
    </div>
  );
}
