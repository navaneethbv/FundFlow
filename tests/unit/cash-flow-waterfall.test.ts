import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CashFlowWaterfall from "@/components/cash-flow/CashFlowWaterfall";
import { buildCashFlowWaterfall } from "@/lib/cash-flow-waterfall";

describe("buildCashFlowWaterfall", () => {
  it("turns income, expenses, and savings into connected balances", () => {
    expect(
      buildCashFlowWaterfall({
        key: "2026-09",
        label: "Sep 2026",
        income: 5000,
        expenses: 3200,
        savings: 1800,
        savingsRate: 36,
      }),
    ).toEqual([
      { key: "income", label: "Income", amount: 5000, start: 0, end: 5000 },
      { key: "expenses", label: "Expenses", amount: -3200, start: 5000, end: 1800 },
      { key: "savings", label: "Savings", amount: 1800, start: 0, end: 1800 },
    ]);
  });

  it("keeps a deficit visible as a negative savings result", () => {
    const steps = buildCashFlowWaterfall({
      key: "2026-09",
      label: "Sep 2026",
      income: 1000,
      expenses: 1200,
      savings: -200,
      savingsRate: -20,
    });
    expect(steps.at(-1)?.end).toBe(-200);
    expect(steps.at(-1)?.amount).toBe(-200);
  });

  it("returns no steps without a selected period", () => {
    expect(buildCashFlowWaterfall(null)).toEqual([]);
  });
});

describe("CashFlowWaterfall", () => {
  it("provides direct labels and a table twin", () => {
    const html = renderToStaticMarkup(
      createElement(CashFlowWaterfall, {
        period: {
          key: "2026-09",
          label: "Sep 2026",
          income: 5000,
          expenses: 3200,
          savings: 1800,
          savingsRate: 36,
        },
        currency: "USD",
      }),
    );
    expect(html).toContain('aria-label="Sep 2026 cash flow waterfall"');
    expect(html).toContain("View data table");
    expect(html).toContain("Income");
    expect(html).toContain("Expenses");
    expect(html).toContain("Savings");
  });
});
