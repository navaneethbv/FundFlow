import { describe, it, expect } from "vitest";
import {
  dashboardUrl,
  normalizeDrillParams,
  subcategoryLabel,
  MANUAL_SPLIT_KEY,
  OTHER_CATEGORY_KEY,
  buildCategoryDrilldown,
  buildMerchantDrilldown,
  type DrillTxn,
} from "@/lib/drilldown";


describe("dashboardUrl", () => {
  it("builds /dashboard with only the params provided, in stable order", () => {
    expect(dashboardUrl({})).toBe("/dashboard");
    expect(dashboardUrl({ tab: "overview", month: "2026-07" })).toBe(
      "/dashboard?tab=overview&month=2026-07",
    );
    expect(dashboardUrl({ view: "monitor", month: "2026-07" })).toBe(
      "/dashboard?view=monitor&month=2026-07",
    );
    expect(
      dashboardUrl({
        tab: "overview",
        month: "2026-07",
        accountId: "acct-1",
        itemId: "item-1",
        category: "FOOD_AND_DRINK",
        sub: "FOOD_AND_DRINK_COFFEE",
      }),
    ).toBe(
      "/dashboard?tab=overview&month=2026-07&accountId=acct-1&itemId=item-1&category=FOOD_AND_DRINK&sub=FOOD_AND_DRINK_COFFEE",
    );
  });

  it("URL-encodes merchant names", () => {
    expect(dashboardUrl({ merchant: "Trader Joe's" })).toBe(
      "/dashboard?merchant=Trader+Joe%27s",
    );
  });
});

describe("normalizeDrillParams", () => {
  const known = {
    categories: new Set(["FOOD_AND_DRINK", "RENT_AND_UTILITIES"]),
    subcategories: new Set(["FOOD_AND_DRINK_COFFEE"]),
    merchants: new Set(["netflix", "trader joe's"]),
  };

  it("accepts a known category and known sub", () => {
    expect(
      normalizeDrillParams(
        { category: "FOOD_AND_DRINK", sub: "FOOD_AND_DRINK_COFFEE" },
        known,
      ),
    ).toEqual({ category: "FOOD_AND_DRINK", sub: "FOOD_AND_DRINK_COFFEE" });
  });

  it("drops an unknown sub but keeps the category", () => {
    expect(
      normalizeDrillParams({ category: "FOOD_AND_DRINK", sub: "NOPE" }, known),
    ).toEqual({ category: "FOOD_AND_DRINK" });
  });

  it("accepts MANUAL_SPLIT and UNCATEGORIZED sentinels as sub", () => {
    expect(
      normalizeDrillParams({ category: "FOOD_AND_DRINK", sub: MANUAL_SPLIT_KEY }, known),
    ).toEqual({ category: "FOOD_AND_DRINK", sub: MANUAL_SPLIT_KEY });
  });

  it("drops a known sub that belongs to a different category (keeps the category)", () => {
    expect(
      normalizeDrillParams(
        { category: "RENT_AND_UTILITIES", sub: "FOOD_AND_DRINK_COFFEE" },
        known,
      ),
    ).toEqual({ category: "RENT_AND_UTILITIES" });
  });

  it("rejects an unknown category entirely (sub dropped too)", () => {
    expect(normalizeDrillParams({ category: "EVIL", sub: "X" }, known)).toEqual({});
  });

  it("passes _other through untouched", () => {
    expect(normalizeDrillParams({ category: OTHER_CATEGORY_KEY }, known)).toEqual({
      category: OTHER_CATEGORY_KEY,
    });
  });

  it("matches merchants case-insensitively, returning the trimmed raw value", () => {
    expect(normalizeDrillParams({ merchant: "  NETFLIX " }, known)).toEqual({
      merchant: "NETFLIX",
    });
    expect(normalizeDrillParams({ merchant: "Unknown Co" }, known)).toEqual({});
  });

  it("category wins over merchant when both are present", () => {
    expect(
      normalizeDrillParams({ category: "FOOD_AND_DRINK", merchant: "Netflix" }, known),
    ).toEqual({ category: "FOOD_AND_DRINK" });
  });
});

describe("subcategoryLabel", () => {
  it("strips the primary-category prefix and title-cases", () => {
    expect(subcategoryLabel("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT")).toBe("Rent");
    expect(
      subcategoryLabel("FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE"),
    ).toBe("Coffee");
  });

  it("handles sentinels and non-prefixed keys", () => {
    expect(subcategoryLabel("FOOD_AND_DRINK", MANUAL_SPLIT_KEY)).toBe("Manual split");
    expect(subcategoryLabel("FOOD_AND_DRINK", "UNCATEGORIZED")).toBe("Uncategorized");
    expect(subcategoryLabel("FOOD_AND_DRINK", "SOMETHING_ELSE")).toBe("Something Else");
  });
});

const WINDOW = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];

function txn(partial: Partial<DrillTxn> & { id: string }): DrillTxn {
  return {
    date: "2026-07-10",
    amount: 100,
    merchant: "Merchant",
    category: "FOOD_AND_DRINK",
    subcategory: "FOOD_AND_DRINK_GROCERIES",
    ...partial,
  };
}

describe("buildCategoryDrilldown", () => {
  it("groups active-month spend by subcategory and ranks merchants", () => {
    const result = buildCategoryDrilldown({
      txns: [
        txn({ id: "a", amount: 60, merchant: "Safeway" }),
        txn({ id: "b", amount: 40, merchant: "Safeway" }),
        txn({ id: "c", amount: 30, merchant: "Blue Bottle", subcategory: "FOOD_AND_DRINK_COFFEE" }),
        txn({ id: "d", amount: 999, category: "TRAVEL", subcategory: null }),
      ],
      splits: [],
      category: "FOOD_AND_DRINK",
      sub: null,
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.kind).toBe("category");
    expect(result.total).toBe(130);
    expect(result.subcategories).toEqual([
      { key: "FOOD_AND_DRINK_GROCERIES", label: "Groceries", amount: 100 },
      { key: "FOOD_AND_DRINK_COFFEE", label: "Coffee", amount: 30 },
    ]);
    expect(result.merchants).toEqual([
      { merchant: "Safeway", amount: 100 },
      { merchant: "Blue Bottle", amount: 30 },
    ]);
    expect(result.transactions.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("null subcategory groups under UNCATEGORIZED", () => {
    const result = buildCategoryDrilldown({
      txns: [txn({ id: "a", subcategory: null })],
      splits: [],
      category: "FOOD_AND_DRINK",
      sub: null,
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.subcategories).toEqual([
      { key: "UNCATEGORIZED", label: "Uncategorized", amount: 100 },
    ]);
  });

  it("valid splits reassign spend into the category with the split amount", () => {
    const result = buildCategoryDrilldown({
      txns: [txn({ id: "a", amount: 100, category: "GENERAL_MERCHANDISE", subcategory: null, merchant: "Costco" })],
      splits: [
        { transactionId: "a", category: "FOOD_AND_DRINK", amount: 70 },
        { transactionId: "a", category: "GENERAL_MERCHANDISE", amount: 30 },
      ],
      category: "FOOD_AND_DRINK",
      sub: null,
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.total).toBe(70);
    expect(result.subcategories).toEqual([
      { key: "MANUAL_SPLIT", label: "Manual split", amount: 70 },
    ]);
    expect(result.transactions).toEqual([
      expect.objectContaining({ id: "a", amount: 70, merchant: "Costco" }),
    ]);
  });

  it("invalid splits (do not sum to the amount) fall back to whole-txn category", () => {
    const result = buildCategoryDrilldown({
      txns: [txn({ id: "a", amount: 100 })],
      splits: [{ transactionId: "a", category: "TRAVEL", amount: 10 }],
      category: "FOOD_AND_DRINK",
      sub: null,
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.total).toBe(100);
  });

  it("builds a 6-month trend and MoM delta for the category", () => {
    const result = buildCategoryDrilldown({
      txns: [
        txn({ id: "a", date: "2026-06-05", amount: 50 }),
        txn({ id: "b", date: "2026-07-05", amount: 80 }),
        txn({ id: "c", date: "2026-03-01", amount: 20 }),
      ],
      splits: [],
      category: "FOOD_AND_DRINK",
      sub: null,
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.trend).toEqual([
      { month: "2026-02", amount: 0 },
      { month: "2026-03", amount: 20 },
      { month: "2026-04", amount: 0 },
      { month: "2026-05", amount: 0 },
      { month: "2026-06", amount: 50 },
      { month: "2026-07", amount: 80 },
    ]);
    expect(result.momDelta).toBe(30);
  });

  it("sub filter scopes everything to one subcategory", () => {
    const result = buildCategoryDrilldown({
      txns: [
        txn({ id: "a", amount: 60 }),
        txn({ id: "b", amount: 30, merchant: "Blue Bottle", subcategory: "FOOD_AND_DRINK_COFFEE" }),
      ],
      splits: [],
      category: "FOOD_AND_DRINK",
      sub: "FOOD_AND_DRINK_COFFEE",
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.total).toBe(30);
    expect(result.merchants).toEqual([{ merchant: "Blue Bottle", amount: 30 }]);
    expect(result.transactions.map((t) => t.id)).toEqual(["b"]);
    expect(result.trend[5]).toEqual({ month: "2026-07", amount: 30 });
  });

  it("transactions sort newest first and cap at 25", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      txn({ id: `t${i}`, date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, amount: 5 }),
    );
    const result = buildCategoryDrilldown({
      txns: many,
      splits: [],
      category: "FOOD_AND_DRINK",
      sub: null,
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.transactions).toHaveLength(25);
    expect(result.transactions[0]!.date >= result.transactions[1]!.date).toBe(true);
  });
});

describe("buildMerchantDrilldown", () => {
  const txns: DrillTxn[] = [
    txn({ id: "a", date: "2026-07-01", amount: 15.49, merchant: "Netflix", category: "ENTERTAINMENT", subcategory: null }),
    txn({ id: "b", date: "2026-06-01", amount: 15.49, merchant: "netflix ", category: "ENTERTAINMENT", subcategory: null }),
    txn({ id: "c", date: "2026-05-01", amount: 12.99, merchant: "Netflix", category: "GENERAL_SERVICES", subcategory: null }),
    txn({ id: "d", date: "2026-07-02", amount: 80, merchant: "Safeway" }),
  ];

  it("matches case-insensitively and computes window stats", () => {
    const result = buildMerchantDrilldown({ txns, merchant: "Netflix", months: WINDOW });
    expect(result.kind).toBe("merchant");
    expect(result.count).toBe(3);
    expect(result.total).toBe(43.97);
    expect(result.average).toBe(14.66);
    expect(result.dominantCategory).toBe("ENTERTAINMENT");
    expect(result.transactions.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("builds the per-month trend", () => {
    const result = buildMerchantDrilldown({ txns, merchant: "Netflix", months: WINDOW });
    expect(result.trend).toEqual([
      { month: "2026-02", amount: 0 },
      { month: "2026-03", amount: 0 },
      { month: "2026-04", amount: 0 },
      { month: "2026-05", amount: 12.99 },
      { month: "2026-06", amount: 15.49 },
      { month: "2026-07", amount: 15.49 },
    ]);
  });

  it("returns zeroed stats for a merchant with no matches", () => {
    const result = buildMerchantDrilldown({ txns, merchant: "Nobody", months: WINDOW });
    expect(result.count).toBe(0);
    expect(result.total).toBe(0);
    expect(result.average).toBe(0);
    expect(result.dominantCategory).toBeNull();
  });
});
