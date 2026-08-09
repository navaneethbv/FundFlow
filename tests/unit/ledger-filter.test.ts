import { describe, it, expect } from "vitest";
import { hasRemapRules, filterRowsWithRules } from "@/lib/ledger-filter";
import type { MerchantRule } from "@/lib/planning";

const accountNames = new Map<string, string>([["acct-1", "Everyday Checking"]]);

function row(over: Partial<Parameters<typeof filterRowsWithRules>[0][number]> & { id: string }) {
  return {
    merchant_name: null,
    name: null,
    pfc_primary: null,
    account_id: "acct-1",
    ...over,
  };
}

describe("hasRemapRules", () => {
  it("is true only when an enabled rule sets a category or display name", () => {
    expect(hasRemapRules([])).toBe(false);
    expect(
      hasRemapRules([{ matchType: "merchant", pattern: "x", enabled: true, category: null, displayName: null }]),
    ).toBe(false);
    expect(
      hasRemapRules([{ matchType: "merchant", pattern: "x", enabled: false, category: "FOOD_AND_DRINK", displayName: null }]),
    ).toBe(false);
    expect(
      hasRemapRules([{ matchType: "merchant", pattern: "x", enabled: true, category: "FOOD_AND_DRINK", displayName: null }]),
    ).toBe(true);
    expect(
      hasRemapRules([{ matchType: "keyword", pattern: "x", enabled: true, category: null, displayName: "Renamed" }]),
    ).toBe(true);
  });
});

describe("filterRowsWithRules", () => {
  const renameAndRecategorize: MerchantRule[] = [
    {
      matchType: "keyword",
      pattern: "sq *bluebottle",
      displayName: "Blue Bottle",
      category: "FOOD_AND_DRINK",
      enabled: true,
    },
  ];

  it("returns rows unchanged when no filter is given", () => {
    const rows = [row({ id: "a", merchant_name: "Anything" })];
    expect(filterRowsWithRules(rows, renameAndRecategorize, accountNames, {})).toBe(rows);
  });

  it("matches a merchant a rule renamed (stored name differs)", () => {
    const rows = [
      row({ id: "a", merchant_name: "SQ *BlueBottle Coffee", pfc_primary: "GENERAL_MERCHANDISE" }),
      row({ id: "b", merchant_name: "Safeway", pfc_primary: "FOOD_AND_DRINK" }),
    ];
    const result = filterRowsWithRules(rows, renameAndRecategorize, accountNames, { merchant: "Blue Bottle" });
    expect(result.map((r) => r.id)).toEqual(["a"]);
  });

  it("matches a category a rule reassigned", () => {
    const rows = [
      row({ id: "a", merchant_name: "SQ *BlueBottle Coffee", pfc_primary: "GENERAL_MERCHANDISE" }),
      row({ id: "b", merchant_name: "Safeway", pfc_primary: "FOOD_AND_DRINK" }),
    ];
    const result = filterRowsWithRules(rows, renameAndRecategorize, accountNames, { category: "FOOD_AND_DRINK" });
    // both belong to FOOD_AND_DRINK after the rule reassigns row a
    expect(result.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("preserves source row order after rule-aware filtering", () => {
    const rows = [
      row({ id: "b", merchant_name: "Safeway", pfc_primary: "FOOD_AND_DRINK" }),
      row({ id: "a", merchant_name: "SQ *BlueBottle Coffee", pfc_primary: "GENERAL_MERCHANDISE" }),
    ];

    expect(
      filterRowsWithRules(rows, renameAndRecategorize, accountNames, {
        category: "FOOD_AND_DRINK",
      }).map((item) => item.id),
    ).toEqual(["b", "a"]);
  });

  it("excludes a row a rule moved OUT of the filtered category", () => {
    const rows = [
      row({ id: "a", merchant_name: "SQ *BlueBottle Coffee", pfc_primary: "GENERAL_MERCHANDISE" }),
    ];
    // the row stores GENERAL_MERCHANDISE but the rule moves it to FOOD_AND_DRINK
    const result = filterRowsWithRules(rows, renameAndRecategorize, accountNames, {
      category: "GENERAL_MERCHANDISE",
    });
    expect(result).toEqual([]);
  });

  it("treats null primary as UNCATEGORIZED", () => {
    const rows = [row({ id: "a", merchant_name: "Mystery", pfc_primary: null })];
    expect(
      filterRowsWithRules(rows, [], accountNames, { category: "UNCATEGORIZED" }).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("falls back to raw name for the merchant when merchant_name is absent", () => {
    const rows = [row({ id: "a", merchant_name: null, name: "NETFLIX.COM" })];
    expect(
      filterRowsWithRules(rows, [], accountNames, { merchant: "netflix.com" }).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("resolves a manual transaction's account name through manual_account_id (Phase 12)", () => {
    const namesWithManual = new Map([...accountNames, ["man-1", "Cash"]]);
    const rows = [
      row({ id: "a", account_id: null, manual_account_id: "man-1", pfc_primary: "FOOD_AND_DRINK" }),
    ];
    // No crash resolving a null account_id, and the row still matches its
    // own category filter — manual transactions aren't silently excluded.
    expect(
      filterRowsWithRules(rows, [], namesWithManual, { category: "FOOD_AND_DRINK" }).map((r) => r.id),
    ).toEqual(["a"]);
  });
});
