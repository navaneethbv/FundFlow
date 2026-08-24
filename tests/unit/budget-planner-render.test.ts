import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BudgetPageData, BudgetSection, BudgetLine } from "@/lib/budget-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import BudgetTable, { validatePlannedAmount } from "@/components/budget/BudgetTable";
import BudgetRightRail from "@/components/budget/BudgetRightRail";
import BudgetPlanner from "@/components/budget/BudgetPlanner";

describe("validatePlannedAmount", () => {
  it("rejects an unparseable value", () => {
    expect(validatePlannedAmount("abc", 100)).toEqual({ ok: false });
  });

  it("rejects a negative value", () => {
    expect(validatePlannedAmount("-5", 100)).toEqual({ ok: false });
  });

  it("marks an unchanged value as not needing a save", () => {
    expect(validatePlannedAmount("100", 100)).toEqual({
      ok: true,
      value: 100,
      changed: false,
    });
  });

  it("marks a genuinely different value as changed", () => {
    expect(validatePlannedAmount("150", 100)).toEqual({
      ok: true,
      value: 150,
      changed: true,
    });
  });

  it("treats zero as a valid, explicit planned amount", () => {
    expect(validatePlannedAmount("0", 100)).toEqual({
      ok: true,
      value: 0,
      changed: true,
    });
  });
});

function line(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    budgetId: "b1",
    category: "GROCERIES",
    label: "Groceries",
    basePlanned: 400,
    planned: 400,
    actual: 300,
    remaining: 100,
    budgeted: true,
    group: "flexible",
    rolloverEnabled: false,
    rolloverCarry: 0,
    sortOrder: 0,
    ...overrides,
  };
}

function section(overrides: Partial<BudgetSection> = {}): BudgetSection {
  return {
    key: "flexible",
    label: "Flexible",
    planned: 400,
    actual: 300,
    remaining: 100,
    lines: [line()],
    unbudgetedCount: 0,
    ...overrides,
  };
}

describe("BudgetTable", () => {
  it("renders the category with its emoji and a progress bar, no explicit Save button", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetTable, {
        section: section(),
        currency: "USD",
        disabled: false,
        onUpdate: vi.fn(),
      }),
    );
    expect(html).toContain("🛒"); // Groceries' mapped emoji
    expect(html).toContain("Groceries");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Plan controls"');
    expect(html).not.toContain('class="sr-only">Plan controls');
    expect(html).not.toContain(">Save<");
  });

  it("colors the remaining amount with the money-direction tokens in both the over- and under-budget cases", () => {
    const over = renderToStaticMarkup(
      createElement(BudgetTable, {
        section: section({
          lines: [line({ actual: 500, remaining: -100 })],
        }),
        currency: "USD",
        disabled: false,
        onUpdate: vi.fn(),
      }),
    );
    expect(over).toContain("-$100.00");
    expect(over).toContain("var(--viz-neg)");

    const under = renderToStaticMarkup(
      createElement(BudgetTable, {
        section: section(),
        currency: "USD",
        disabled: false,
        onUpdate: vi.fn(),
      }),
    );
    expect(under).toContain("$100.00");
    expect(under).toContain("var(--viz-pos)");
  });

  it("carries every remaining/actual/planned figure inside the privacy-blur hook", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetTable, {
        section: section(),
        currency: "USD",
        disabled: false,
        onUpdate: vi.fn(),
      }),
    );
    // Section header: planned, actual, remaining (3). Row: remaining (1). 4 total.
    const occurrences = html.match(/data-money/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(4);
  });

  it("colors the section-header remaining figure symmetrically, not just the over-budget case", () => {
    const surplus = renderToStaticMarkup(
      createElement(BudgetTable, {
        section: section({ remaining: 50 }),
        currency: "USD",
        disabled: false,
        onUpdate: vi.fn(),
      }),
    );
    expect(surplus).toContain("var(--viz-pos)");
    expect(surplus).not.toContain("text-danger");
    expect(surplus).not.toContain('text-foreground"');
  });

  it("hides an unbudgeted line by default behind a Show N unbudgeted toggle", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetTable, {
        section: section({
          lines: [line(), line({ budgetId: null, budgeted: false, remaining: -50 })],
          unbudgetedCount: 1,
        }),
        currency: "USD",
        disabled: false,
        onUpdate: vi.fn(),
      }),
    );
    expect(html).not.toContain("Unbudgeted");
    expect(html).not.toContain("Create a budget to edit");
    expect(html).toContain("Show 1 unbudgeted");
  });

  it("shows the eye-icon toggle only when there are unbudgeted lines to reveal", () => {
    const withUnbudgeted = renderToStaticMarkup(
      createElement(BudgetTable, {
        section: section({ unbudgetedCount: 3 }),
        currency: "USD",
        disabled: false,
        onUpdate: vi.fn(),
      }),
    );
    expect(withUnbudgeted).toContain("Show 3 unbudgeted");

    const withoutUnbudgeted = renderToStaticMarkup(
      createElement(BudgetTable, {
        section: section({ unbudgetedCount: 0 }),
        currency: "USD",
        disabled: false,
        onUpdate: vi.fn(),
      }),
    );
    expect(withoutUnbudgeted).not.toContain("unbudgeted");
  });
});

function pageData(overrides: Partial<BudgetPageData> = {}): BudgetPageData {
  return {
    month: "2026-07",
    horizon: "monthly",
    sections: [
      {
        key: "income",
        label: "Income",
        planned: 5000,
        actual: 5200,
        remaining: 200,
        lines: [],
        unbudgetedCount: 0,
      },
      section({ key: "fixed", label: "Fixed", planned: 2000, actual: 2000, remaining: 0, lines: [] }),
      section({ key: "flexible", label: "Flexible" }),
      section({ key: "non_monthly", label: "Non-Monthly", planned: 0, actual: 0, remaining: 0, lines: [] }),
    ],
    totalIncome: { planned: 5000, actual: 5200 },
    totalExpenses: { planned: 2400, actual: 2300, remaining: 100 },
    contributions: { goals: [] },
    leftToBudget: 2600,
    sinkingFundsTotal: 150,
    ...overrides,
  };
}

describe("BudgetRightRail", () => {
  const links = { summary: "/budget", income: "/budget?summary=income", expenses: "/budget?summary=expenses" };

  it("tints the hero green for a surplus and shows the group mini-summaries", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetRightRail, {
        data: pageData(),
        currency: "USD",
        tab: "summary" as const,
        links,
      }),
    );
    expect(html).toContain("$2,600.00");
    expect(html).toContain("Left to budget");
    expect(html).toContain("Flexible");
    // Income never appears among the expense-group mini-summaries.
    expect(html).not.toMatch(/<span class="font-semibold">Income<\/span>/);
  });

  it("tints the hero red for a deficit", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetRightRail, {
        data: pageData({ leftToBudget: -400 }),
        currency: "USD",
        tab: "summary" as const,
        links,
      }),
    );
    expect(html).toContain("text-danger");
    expect(html).toContain("-$400.00");
  });

  it("shows income-specific figures only on the income tab", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetRightRail, {
        data: pageData(),
        currency: "USD",
        tab: "income" as const,
        links,
      }),
    );
    expect(html).toContain("Planned income");
    expect(html).toContain("Actual income");
    // Expense group mini-summaries are Expenses/Summary-tab-only.
    expect(html).not.toContain("Flexible");
  });
});

describe("BudgetPlanner", () => {
  it("groups sections under Income/Expenses/Contributions bands with totals rows and a Left to Budget footer", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetPlanner, {
        initialView: { horizon: "monthly" as const, month: pageData() },
        proposals: [],
        month: "2026-07",
        currency: "USD",
        summaryTab: "summary" as const,
        summaryLinks: {
          summary: "/budget",
          income: "/budget?summary=income",
          expenses: "/budget?summary=expenses",
        },
      }),
    );
    expect(html).toContain("Income");
    expect(html).toContain("Expenses");
    expect(html).toContain("Contributions");
    expect(html).toContain("Total Income");
    expect(html).toContain("Total Expenses");
    expect(html).toContain("Left to Budget");
    expect(html).toContain("$2,600.00");
  });

  it("tints the Left to Budget footer bar for a deficit", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetPlanner, {
        initialView: { horizon: "monthly" as const, month: pageData({ leftToBudget: -300 }) },
        proposals: [],
        month: "2026-07",
        currency: "USD",
        summaryTab: "summary" as const,
        summaryLinks: {
          summary: "/budget",
          income: "/budget?summary=income",
          expenses: "/budget?summary=expenses",
        },
      }),
    );
    expect(html).toContain("bg-danger");
  });
});
