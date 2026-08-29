import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AllocationView from "@/components/investments/AllocationView";
import type { InvestmentsPage } from "@/lib/investments";

function page(overrides: Partial<InvestmentsPage> = {}): InvestmentsPage {
  return {
    total: 2500,
    dayChange: null,
    byClass: [{ label: "Funds", holdings: [], subtotal: 2500 }],
    topMovers: null,
    balanceHistory: [],
    ...overrides,
  };
}

describe("AllocationView", () => {
  it("shows an empty state when the portfolio total is zero", () => {
    const html = renderToStaticMarkup(
      createElement(AllocationView, { page: page({ total: 0, byClass: [] }), currency: "USD" }),
    );
    expect(html).toContain("Add a holding to see how your portfolio is allocated.");
  });

  it("carries each class's subtotal inside the privacy-blur hook", () => {
    const html = renderToStaticMarkup(
      createElement(AllocationView, { page: page(), currency: "USD" }),
    );
    expect(html).toContain("data-money");
    expect(html).toContain("$2,500.00");
  });

  it("labels each class with its share of the total", () => {
    const html = renderToStaticMarkup(
      createElement(AllocationView, { page: page(), currency: "USD" }),
    );
    expect(html).toContain("Funds");
    expect(html).toContain("100.0%");
  });
});