import { describe, it, expect } from "vitest";
import { NAV_ITEMS, UTILITY_ITEMS } from "@/components/shell/nav-model";

describe("Navigation Model (NAV_ITEMS)", () => {
  it("defines unique keys and absolute hrefs for all nav items", () => {
    const keys = new Set<string>();
    for (const item of NAV_ITEMS) {
      expect(keys.has(item.key)).toBe(false);
      keys.add(item.key);
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon).toBeDefined();
    }
  });

  it("contains all 14 expected navigation sections", () => {
    const expectedKeys = [
      "dashboard",
      "accounts",
      "transactions",
      "cashflow",
      "reports",
      "budget",
      "recurring",
      "goals",
      "investments",
      "forecasting",
      "advice",
      "notifications",
      "settings",
      "wrapped",
    ];
    const keys = NAV_ITEMS.map((item) => item.key);
    for (const key of expectedKeys) {
      expect(keys).toContain(key);
    }
  });

  it("defines utility items for search, notifications, and settings", () => {
    expect(UTILITY_ITEMS.length).toBeGreaterThanOrEqual(3);
    const actions = UTILITY_ITEMS.map((u) => u.action);
    expect(actions).toContain("search");
    expect(actions).toContain("notifications");
    expect(actions).toContain("settings");
  });
});
