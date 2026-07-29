import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "@/components/shell/nav-model";
import { isFeatureEnabled } from "@/lib/feature-flags";

describe("Sidebar Navigation Contract", () => {
  it("includes /budget link when budgetPage flag is enabled", () => {
    const budgetItem = NAV_ITEMS.find((item) => item.key === "budget");
    expect(budgetItem).toBeDefined();
    expect(budgetItem?.href).toBe("/budget");
    expect(isFeatureEnabled(budgetItem!.featureFlag!, { FUNDFLOW_FEATURE_FLAGS: "budgetPage" })).toBe(true);
  });

  it("excludes /budget link when budgetPage flag is disabled", () => {
    const budgetItem = NAV_ITEMS.find((item) => item.key === "budget");
    expect(isFeatureEnabled(budgetItem!.featureFlag!, { FUNDFLOW_FEATURE_FLAGS: "" })).toBe(false);
  });

  it("does not include unreleased future-phase routes in NAV_ITEMS", () => {
    const keys = NAV_ITEMS.map((item) => item.key);
    expect(keys).not.toContain("recurring");
    expect(keys).not.toContain("reports");
    expect(keys).not.toContain("investments");
    expect(keys).not.toContain("forecasting");
    expect(keys).not.toContain("advice");
  });
});
