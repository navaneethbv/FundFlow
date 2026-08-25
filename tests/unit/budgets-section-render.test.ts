import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BudgetsSection from "@/components/settings/BudgetsSection";

describe("BudgetsSection", () => {
  it("wraps each budget's monthly limit inside the privacy-blur hook", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetsSection, {
        initialBudgets: [{ id: "b1", category: "FOOD_AND_DRINK", monthly_limit: 500 }],
      }),
    );
    expect(html).toContain("data-money");
    expect(html).toContain("$500.00");
  });

  it("wraps a suggested budget's median and CTA amount inside the privacy-blur hook", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetsSection, {
        initialBudgets: [],
        suggestions: [{ category: "TRAVEL", suggestedLimit: 300, median: 285, months: 6 }],
      }),
    );
    // The median span already carried data-money; the CTA amount span is the
    // new coverage this task adds — at least two occurrences for one suggestion.
    expect(html.match(/data-money/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("$300.00");
  });
});