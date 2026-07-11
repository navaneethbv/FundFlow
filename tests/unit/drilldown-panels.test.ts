import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CategoryDrilldownPanel from "@/components/dashboard/CategoryDrilldownPanel";
import MerchantDrilldownPanel from "@/components/dashboard/MerchantDrilldownPanel";
import type { CategoryDrilldownData, MerchantDrilldownData } from "@/lib/drilldown";

const linkParams = { tab: "overview", month: "2026-07" };

const categoryDrill: CategoryDrilldownData = {
  kind: "category",
  category: "FOOD_AND_DRINK",
  sub: null,
  total: 488.25,
  momDelta: -42.1,
  subcategories: [
    { key: "FOOD_AND_DRINK_GROCERIES", label: "Groceries", amount: 300 },
    { key: "FOOD_AND_DRINK_COFFEE", label: "Coffee", amount: 188.25 },
  ],
  merchants: [{ merchant: "Safeway", amount: 300 }],
  trend: [
    { month: "2026-02", amount: 0 },
    { month: "2026-03", amount: 120 },
    { month: "2026-04", amount: 200 },
    { month: "2026-05", amount: 310 },
    { month: "2026-06", amount: 530.35 },
    { month: "2026-07", amount: 488.25 },
  ],
  transactions: [
    {
      id: "t1",
      date: "2026-07-08",
      amount: 84.1,
      merchant: "Safeway",
      category: "FOOD_AND_DRINK",
      subcategory: "FOOD_AND_DRINK_GROCERIES",
    },
  ],
};

describe("CategoryDrilldownPanel", () => {
  const html = renderToStaticMarkup(
    createElement(CategoryDrilldownPanel, { drill: categoryDrill, linkParams, month: "2026-07" }),
  );

  it("renders breadcrumb with a link back to all categories", () => {
    expect(html).toContain("All categories");
    expect(html).toContain('href="/dashboard?tab=overview&amp;month=2026-07"');
    expect(html).toContain("Food And Drink");
  });

  it("links subcategories to sub drills", () => {
    expect(html).toContain(
      'href="/dashboard?tab=overview&amp;month=2026-07&amp;category=FOOD_AND_DRINK&amp;sub=FOOD_AND_DRINK_GROCERIES"',
    );
  });

  it("links merchants to merchant drills", () => {
    expect(html).toContain('href="/dashboard?tab=overview&amp;month=2026-07&amp;merchant=Safeway"');
  });

  it("shows MoM delta, transactions, and a ledger link with exact filters", () => {
    expect(html).toContain("vs last month");
    expect(html).toContain("Safeway");
    expect(html).toContain("2026-07-08");
    expect(html).toContain(
      'href="/transactions?month=2026-07&amp;category=FOOD_AND_DRINK"',
    );
  });

  it("at sub level, breadcrumb links back to the category and ledger carries sub", () => {
    const subHtml = renderToStaticMarkup(
      createElement(CategoryDrilldownPanel, {
        drill: { ...categoryDrill, sub: "FOOD_AND_DRINK_COFFEE" },
        linkParams,
        month: "2026-07",
      }),
    );
    expect(subHtml).toContain(
      'href="/dashboard?tab=overview&amp;month=2026-07&amp;category=FOOD_AND_DRINK"',
    );
    expect(subHtml).toContain(
      'href="/transactions?month=2026-07&amp;category=FOOD_AND_DRINK&amp;sub=FOOD_AND_DRINK_COFFEE"',
    );
  });
});

describe("MerchantDrilldownPanel", () => {
  const merchantDrill: MerchantDrilldownData = {
    kind: "merchant",
    merchant: "Netflix",
    total: 46.47,
    count: 3,
    average: 15.49,
    dominantCategory: "ENTERTAINMENT",
    trend: [
      { month: "2026-02", amount: 0 },
      { month: "2026-03", amount: 15.49 },
      { month: "2026-04", amount: 0 },
      { month: "2026-05", amount: 15.49 },
      { month: "2026-06", amount: 0 },
      { month: "2026-07", amount: 15.49 },
    ],
    transactions: [
      {
        id: "n1",
        date: "2026-07-01",
        amount: 15.49,
        merchant: "Netflix",
        category: "ENTERTAINMENT",
        subcategory: null,
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(MerchantDrilldownPanel, { drill: merchantDrill, linkParams, month: "2026-07" }),
  );

  it("shows stats and links the dominant category to a category drill", () => {
    expect(html).toContain("Netflix");
    expect(html).toContain("3"); // count
    expect(html).toContain(
      'href="/dashboard?tab=overview&amp;month=2026-07&amp;category=ENTERTAINMENT"',
    );
  });

  it("links to the ledger filtered by merchant", () => {
    expect(html).toContain('href="/transactions?month=2026-07&amp;merchant=Netflix"');
  });
});
