import { describe, it, expect } from "vitest";
import { normalizeWidgetPrefs, computeCumulativeSpendByDay } from "@/lib/dashboard-widgets";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

describe("lib/dashboard-widgets.ts", () => {
  it("normalizes widget preferences safely", () => {
    const prefs = normalizeWidgetPrefs({ order: ["budget", "invalid"], hidden: ["goals"] });
    expect(prefs.order).toContain("budget");
    expect(prefs.order).toContain("netWorth");
    expect(prefs.hidden).toEqual(["goals"]);
  });

  it("computes cumulative spending comparison by day of month", () => {
    const txns: CanonicalFinanceTransaction[] = [
      {
        id: "t1",
        date: "2026-07-05",
        signedAmount: 100,
        flow: "expense",
        merchant: "Store",
        groupKey: "FOOD",
        categoryKey: "GROCERIES",
        accountId: "a1",
        manualAccountId: null,
        pending: false,
        source: "plaid",
        sourceTransactionId: "t1",
      },
      {
        id: "t2",
        date: "2026-06-05",
        signedAmount: 80,
        flow: "expense",
        merchant: "Store",
        groupKey: "FOOD",
        categoryKey: "GROCERIES",
        accountId: "a1",
        manualAccountId: null,
        pending: false,
        source: "plaid",
        sourceTransactionId: "t2",
      },
    ];

    const res = computeCumulativeSpendByDay(txns, "2026-07", 10);
    expect(res.length).toBe(31);
    expect(res[4].thisMonth).toBe(100);
    expect(res[4].lastMonth).toBe(80);
    expect(res[20].thisMonth).toBeNull();
  });
});
