import type { PeriodCashFlow } from "@/lib/cash-flow";

export type CashFlowWaterfallKind = "income" | "expenses" | "savings";

export interface CashFlowWaterfallStep {
  key: CashFlowWaterfallKind;
  label: string;
  amount: number;
  start: number;
  end: number;
}

/**
 * Turn one period into the three statements a waterfall needs: money in,
 * money out, and the resulting savings balance. Expenses are represented as a
 * subtraction from income while savings is drawn from the zero baseline so the
 * result can be compared with the starting amount.
 */
export function buildCashFlowWaterfall(
  period: PeriodCashFlow | null,
): CashFlowWaterfallStep[] {
  if (!period) return [];
  const savings = period.savings;
  return [
    {
      key: "income",
      label: "Income",
      amount: period.income,
      start: 0,
      end: period.income,
    },
    {
      key: "expenses",
      label: "Expenses",
      amount: -period.expenses,
      start: period.income,
      end: savings,
    },
    {
      key: "savings",
      label: "Savings",
      amount: savings,
      start: 0,
      end: savings,
    },
  ];
}
