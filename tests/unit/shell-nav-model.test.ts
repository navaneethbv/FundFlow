import { describe, it, expect } from "vitest";
import {
  NAV_ITEMS,
  UTILITY_ITEMS,
  getEnabledNavItems,
} from "@/components/shell/nav-model";

describe("components/shell/nav-model.ts", () => {
  it("contains unique nav item keys and valid hrefs", () => {
    const keys = new Set<string>();
    for (const item of NAV_ITEMS) {
      expect(keys.has(item.key)).toBe(false);
      keys.add(item.key);
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
      expect(item.icon).toBeDefined();
      expect(["primary", "planning", "manage"]).toContain(item.category);
    }
  });

  it("filters nav items based on feature flags", () => {
    // With flags turned off via -flag syntax
    const allOff = getEnabledNavItems({
      FUNDFLOW_FEATURE_FLAGS:
        "-accountsPage,-cashFlowPage,-reportsPage,-budgetPage,-recurringPage,-investmentsPage,-forecastingPage,-advicePage",
    });

    const offKeys = allOff.map((item) => item.key);
    expect(offKeys).toContain("dashboard");
    expect(offKeys).toContain("transactions");
    expect(offKeys).toContain("goals");
    expect(offKeys).toContain("debt");
    expect(offKeys).not.toContain("accounts");
    expect(offKeys).not.toContain("forecasting");

    // With accounts enabled
    const accountsOn = getEnabledNavItems({
      FUNDFLOW_FEATURE_FLAGS: "accountsPage",
    });
    expect(accountsOn.map((i) => i.key)).toContain("accounts");

    // Default env
    const defaultItems = getEnabledNavItems();
    expect(defaultItems.length).toBeGreaterThan(0);
  });

  it("exposes utility items with defined icons and actions", () => {
    expect(UTILITY_ITEMS.length).toBe(3);
    const actions = UTILITY_ITEMS.map((u) => u.action);
    expect(actions).toEqual(["search", "notifications", "settings"]);
    for (const item of UTILITY_ITEMS) {
      expect(item.icon).toBeDefined();
      expect(item.label).toBeDefined();
    }
  });
});
