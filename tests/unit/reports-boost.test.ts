import { describe, expect, it } from "vitest";
import {
  applyReportFilters,
  buildCashFlowSankeyData,
  reportFiltersToSearchParams,
  parseReportFilters,
  type ReportFilters,
} from "@/lib/reports";

describe("Reports Module Extra Branches", () => {
  it("validates report filters with various scope, string lists, and tab options", () => {
    expect(parseReportFilters(null)).toBeNull();
    expect(parseReportFilters({ scope: "   " })).toBeNull(); // empty string scope
    expect(parseReportFilters({ scope: "a".repeat(200) })).toBeNull(); // too long scope
    expect(parseReportFilters({ scope: 123 })).toBeNull(); // invalid type

    const validRaw = {
      version: 1,
      start: "2026-08-01",
      end: "2026-08-31",
      tab: "cash_flow",
      mode: "breakdown",
      dimension: "category",
      scope: "household",
      accounts: ["acc-1"],
      merchants: ["Target"],
      categories: ["Groceries"],
      excludePending: true,
    };
    const parsed = parseReportFilters(validRaw);
    expect(parsed).not.toBeNull();
    expect(parsed?.scope).toBe("household");
  });

  it("applies report filters with manual accounts, merchants, categories, and pending", () => {
    const filters: ReportFilters = {
      version: 1,
      start: "2026-08-01",
      end: "2026-08-31",
      tab: "cash_flow",
      mode: "breakdown",
      dimension: "category",
      scope: null,
      accounts: ["m-1"],
      merchants: ["Costco"],
      categories: ["Food"],
      excludePending: true,
    };

    const rows = [
      {
        id: "r1",
        sourceTransactionId: "t1",
        date: "2026-08-15",
        signedAmount: 100,
        flow: "expense" as const,
        categoryKey: "Food",
        groupKey: "FOOD_AND_DRINK",
        merchant: "Costco",
        accountId: null,
        manualAccountId: "m-1",
        pending: false,
        source: "manual" as const,
      },
      {
        id: "r2",
        sourceTransactionId: "t2",
        date: "2026-08-15",
        signedAmount: 50,
        flow: "expense" as const,
        categoryKey: "Food",
        groupKey: "FOOD_AND_DRINK",
        merchant: "Costco",
        accountId: null,
        manualAccountId: "m-1",
        pending: true, // excluded by excludePending
        source: "manual" as const,
      },
      {
        id: "r3",
        sourceTransactionId: "t3",
        date: "2026-08-15",
        signedAmount: 50,
        flow: "expense" as const,
        categoryKey: "Food",
        groupKey: "FOOD_AND_DRINK",
        merchant: "Walmart", // excluded by merchant
        accountId: null,
        manualAccountId: "m-1",
        pending: false,
        source: "manual" as const,
      },
    ];

    const filtered = applyReportFilters(rows, filters);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.sourceTransactionId).toBe("t1");
  });

  it("converts report filters to URL search params with include pending and scope", () => {
    const filtersInclude: ReportFilters = {
      version: 1,
      start: "2026-08-01",
      end: "2026-08-31",
      tab: "spending",
      mode: "breakdown",
      dimension: "group",
      scope: "mine",
      accounts: ["a1", "a2"],
      merchants: ["M1"],
      categories: ["C1"],
      excludePending: false,
    };
    const params = reportFiltersToSearchParams(filtersInclude);
    expect(params.get("pending")).toBe("include");
    expect(params.get("scope")).toBe("mine");
    expect(params.getAll("account")).toEqual(["a1", "a2"]);
  });

  it("builds Sankey data with equal amount and display sorting", () => {
    const sankey = buildCashFlowSankeyData([
      {
        id: "s1",
        sourceTransactionId: "t1",
        date: "2026-08-01",
        signedAmount: -2000,
        flow: "income" as const,
        categoryKey: "Salary B",
        groupKey: "INCOME",
        merchant: "Job",
        accountId: null,
        manualAccountId: "m-1",
        pending: false,
        source: "manual" as const,
      },
      {
        id: "s2",
        sourceTransactionId: "t2",
        date: "2026-08-01",
        signedAmount: -2000,
        flow: "income" as const,
        categoryKey: "Salary A",
        groupKey: "INCOME",
        merchant: "Job",
        accountId: null,
        manualAccountId: "m-1",
        pending: false,
        source: "manual" as const,
      },
      {
        id: "s3",
        sourceTransactionId: "t3",
        date: "2026-08-01",
        signedAmount: 1000,
        flow: "expense" as const,
        categoryKey: "Rent",
        groupKey: "RENT_AND_UTILITIES",
        merchant: "Landlord",
        accountId: null,
        manualAccountId: "m-1",
        pending: false,
        source: "manual" as const,
      },
    ]);
    expect(sankey.nodes.length).toBeGreaterThan(0);
  });
});
