import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MonthSummary from "@/components/recurring/MonthSummary";
import type { RecurringMonth } from "@/lib/recurring-page";

function totals(overrides: Partial<RecurringMonth["totals"]> = {}): RecurringMonth["totals"] {
  return {
    income: { paid: 2000, remaining: 450 },
    expenses: { paid: 1200, remaining: 300 },
    creditCards: { paid: 0, remaining: 0 },
    ...overrides,
  };
}

describe("MonthSummary", () => {
  it("shows each column's total, paid, and remaining figures", () => {
    const html = renderToStaticMarkup(
      createElement(MonthSummary, { totals: totals(), currency: "USD" }),
    );
    expect(html).toContain("$2,450.00 total");
    expect(html).toContain("$2,000.00 paid");
    expect(html).toContain("$450.00 remaining");
  });

  it("carries the total figure inside the privacy-blur hook, alongside paid and remaining", () => {
    const html = renderToStaticMarkup(
      createElement(MonthSummary, { totals: totals(), currency: "USD" }),
    );
    // Income and Expenses columns each render 3 data-money spans (total, paid,
    // remaining); the empty credit-card state has no money values, so the
    // total remains 6.
    expect(html.match(/data-money/g)?.length).toBe(6);
  });

  it("keeps a credit cards column visible when bills are unavailable", () => {
    const withCards = renderToStaticMarkup(
      createElement(MonthSummary, {
        totals: totals({ creditCards: { paid: 100, remaining: 50 } }),
        currency: "USD",
      }),
    );
    expect(withCards).toContain("Credit cards");

    const withoutCards = renderToStaticMarkup(
      createElement(MonthSummary, { totals: totals(), currency: "USD" }),
    );
    expect(withoutCards).toContain("Credit cards");
    expect(withoutCards).toContain("No credit-card bills tracked.");
  });
});
