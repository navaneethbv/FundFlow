import { existsSync } from "node:fs";
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

  it("ships /budget after its production migration", () => {
    const budgetItem = NAV_ITEMS.find((item) => item.key === "budget");
    expect(isFeatureEnabled(budgetItem!.featureFlag!, { FUNDFLOW_FEATURE_FLAGS: "" })).toBe(true);
  });

  it("does not include unreleased future-phase routes in NAV_ITEMS", () => {
    const keys = NAV_ITEMS.map((item) => item.key);
    expect(keys).not.toContain("recurring");
    expect(keys).not.toContain("reports");
    expect(keys).not.toContain("investments");
    expect(keys).not.toContain("forecasting");
    expect(keys).not.toContain("advice");
  });

  it("does not ship future-phase API or settings modules", () => {
    expect(existsSync("app/api/recurring/route.ts")).toBe(false);
    expect(existsSync("app/api/reports/saved/route.ts")).toBe(false);
    expect(existsSync("components/charts/CumulativeCompareChart.tsx")).toBe(
      false,
    );
    expect(existsSync("components/settings/settings-nav.ts")).toBe(false);
  });
});
