import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DivergingColumns from "@/components/charts/DivergingColumns";
import BreakdownBars from "@/components/cash-flow/BreakdownBars";
import CashFlowControls from "@/components/cash-flow/CashFlowControls";
import CashFlowSummary from "@/components/cash-flow/CashFlowSummary";
import PeriodBars from "@/components/cash-flow/PeriodBars";
import type { BreakdownRow, PeriodCashFlow } from "@/lib/cash-flow";

const periods: PeriodCashFlow[] = [
  {
    key: "2026-06",
    label: "Jun 2026",
    income: 1000,
    expenses: 800,
    savings: 200,
    savingsRate: 20,
  },
  {
    key: "2026-07",
    label: "Jul 2026",
    income: 900,
    expenses: 1200,
    savings: -300,
    savingsRate: -33.33,
  },
];

describe("Cash Flow charts", () => {
  it("renders a signed cumulative savings overlay on the shared scale and table", () => {
    const html = renderToStaticMarkup(
      createElement(DivergingColumns, {
        labels: ["Jun 2026", "Jul 2026"],
        up: [1000, 900],
        down: [800, 1200],
        upName: "Income",
        downName: "Expenses",
        line: {
          name: "Cumulative savings",
          values: [200, -100],
        },
      }),
    );

    expect(html).toContain('data-series="Cumulative savings"');
    expect(html).toContain('stroke="var(--viz-ink)"');
    expect(html).toContain("Cumulative savings");
    expect(html).toContain("<table");
    expect(html).not.toContain("NaN");
  });

  it("wraps the diverging chart with period links and cumulative savings", () => {
    const html = renderToStaticMarkup(
      createElement(PeriodBars, {
        periods,
        currency: "CAD",
        links: [
          "/cash-flow?selected=2026-06",
          "/cash-flow?selected=2026-07",
        ],
      }),
    );

    expect(html).toContain("Income");
    expect(html).toContain("Expenses");
    expect(html).toContain("Cumulative savings");
    expect(html).toContain('href="/cash-flow?selected=2026-07"');
    expect(html).not.toContain("NaN");
  });
});

describe("BreakdownBars", () => {
  const rows: BreakdownRow[] = [
    { label: "Housing", amount: 700, pct: 35 },
    { label: "Groceries", amount: 500, pct: 25 },
    { label: "Dining", amount: 300, pct: 15 },
    { label: "Travel", amount: 200, pct: 10 },
    { label: "Shopping", amount: 140, pct: 7 },
    { label: "Utilities", amount: 100, pct: 5 },
    { label: "Health", amount: 60, pct: 3 },
  ];

  it("folds only the visible bars while retaining every table row", () => {
    const html = renderToStaticMarkup(
      createElement(BreakdownBars, {
        title: "Expenses",
        rows,
        currency: "USD",
        dimension: "merchant",
      }),
    );

    expect(html.match(/data-breakdown-bar=/g)).toHaveLength(6);
    expect(html).toContain("Other");
    for (const row of rows) {
      expect(html).toContain(`<td>${row.label}</td>`);
    }
    expect(html).toContain("View complete Expenses table");
  });

  it("renders an honest direction-specific empty state", () => {
    const html = renderToStaticMarkup(
      createElement(BreakdownBars, {
        title: "Income",
        rows: [],
        currency: "USD",
        dimension: "merchant",
      }),
    );

    expect(html).toContain("No income data for this period.");
  });

  it("humanizes canonical category keys without changing merchant names", () => {
    const html = renderToStaticMarkup(
      createElement(BreakdownBars, {
        title: "Expenses",
        rows: [
          {
            label: "GENERAL_MERCHANDISE_OTHER",
            amount: 100,
            pct: 100,
          },
        ],
        currency: "USD",
        dimension: "category",
      }),
    );

    expect(html).toContain("General Merchandise Other");
    expect(html).not.toContain("GENERAL_MERCHANDISE_OTHER");
  });
});

describe("CashFlowSummary", () => {
  it("formats the selected period without hiding negative savings", () => {
    const html = renderToStaticMarkup(
      createElement(CashFlowSummary, {
        period: periods[1]!,
        currency: "CAD",
      }),
    );

    expect(html).toContain("Jul 2026");
    expect(html).toContain("CA$900.00");
    expect(html).toContain("CA$1,200.00");
    expect(html).toContain("-CA$300.00");
    expect(html).toContain("-33.33%");
  });

  it("does not invent selected-period totals when no period exists", () => {
    const html = renderToStaticMarkup(
      createElement(CashFlowSummary, {
        period: null,
        currency: "USD",
      }),
    );

    expect(html).toContain("No selected-period totals are available.");
  });

  it("does not invent a currency symbol when account currency is unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(CashFlowSummary, {
        period: periods[0]!,
        currency: "Unknown currency",
      }),
    );

    expect(html).toContain("1,000.00");
    expect(html).not.toContain("$1,000.00");
  });
});

describe("CashFlowControls", () => {
  it("preserves canonical URL state across period, dimension, scope, and currency controls", () => {
    const html = renderToStaticMarkup(
      createElement(CashFlowControls, {
        current: {
          period: "monthly",
          range: "12",
          selected: "2026-07",
          dimension: "category",
          scope: "household-1",
          currency: "USD",
        },
        periods: [
          { key: "2026-06", label: "Jun 2026" },
          { key: "2026-07", label: "Jul 2026" },
        ],
        currencies: ["CAD", "USD"],
        householdId: "household-1",
      }),
    );

    expect(html).toContain('href="/cash-flow?period=quarterly');
    expect(html).toContain("dimension=merchant");
    expect(html).toContain("scope=household-1");
    expect(html).toContain("currency=CAD");
    expect(html).toContain('name="selected"');
    expect(html).toContain('name="range"');
    expect(html).toContain(">Just mine<");
    expect(html).toContain(">Household<");
  });

  it("hides Household and currency controls when neither choice exists", () => {
    const html = renderToStaticMarkup(
      createElement(CashFlowControls, {
        current: {
          period: "monthly",
          range: "12",
          selected: "2026-07",
          dimension: "category",
          currency: "USD",
        },
        periods: [{ key: "2026-07", label: "Jul 2026" }],
        currencies: ["USD"],
      }),
    );

    expect(html).not.toContain(">Household<");
    expect(html).not.toContain("Currency");
  });
});
