import { describe, expect, it } from "vitest";
import { applyPlaidCategoryMapping, buildPlaidCategoryMap, normalizePlaidCode } from "@/lib/plaid-category-mapping";

describe("Plaid category mappings", () => {
  it("normalizes codes and applies the detailed code before rules", () => {
    const mappings = buildPlaidCategoryMap([{ pfcDetailed: " travel.airfare ", displayCategory: " Travel " }]);
    expect(normalizePlaidCode(" travel.airfare ")).toBe("TRAVEL.AIRFARE");
    expect(applyPlaidCategoryMapping({ pfc_detailed: "TRAVEL.AIRFARE", pfc_primary: "OLD" }, mappings).pfc_primary).toBe("Travel");
  });

  it("leaves rows without a mapping untouched", () => {
    const row = { id: "t1", pfc_detailed: "FOOD.GROCERIES", pfc_primary: "FOOD" };
    expect(applyPlaidCategoryMapping(row, new Map())).toEqual(row);
  });
});
