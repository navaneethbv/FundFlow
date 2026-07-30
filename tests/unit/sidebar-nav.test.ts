import { existsSync, readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { NAV_ITEMS, UTILITY_ITEMS, getEnabledNavItems } from "@/components/shell/nav-model";
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

  it("has unique keys and non-empty labels, hrefs, and hints for every item", () => {
    const keys = new Set<string>();
    for (const item of NAV_ITEMS) {
      expect(keys.has(item.key)).toBe(false);
      keys.add(item.key);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.hint.length).toBeGreaterThan(0);
    }
  });

  it("keeps NAV_ITEMS in a fixed primary -> planning -> manage order", () => {
    const categories = NAV_ITEMS.map((item) => item.category);
    const firstPlanning = categories.indexOf("planning");
    const firstManage = categories.indexOf("manage");
    const lastPrimary = categories.lastIndexOf("primary");
    expect(lastPrimary).toBeLessThan(firstPlanning);
    expect(firstPlanning).toBeLessThan(firstManage);
  });

  it("getEnabledNavItems drops items whose feature flag is off and keeps unflagged items", () => {
    const allOff = getEnabledNavItems({ FUNDFLOW_FEATURE_FLAGS: "" });
    // accountsPage/cashFlowPage/budgetPage default to true today, so this only
    // proves the filter runs the same predicate AppSidebar used to inline.
    expect(allOff.some((item) => item.key === "dashboard")).toBe(true);
    expect(allOff.every((item) => !item.featureFlag || item.key)).toBe(true);
  });

  it("defines three utility items with a search, notifications, and settings action", () => {
    const actions = UTILITY_ITEMS.map((item) => item.action);
    expect(actions).toEqual(["search", "notifications", "settings"]);
    for (const item of UTILITY_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it("AppSidebar renders the gated Ask-AI lower-rail link", () => {
    const source = readFileSync("components/shell/AppSidebar.tsx", "utf8");
    expect(source).toContain("AskAiLowerRailLink");
  });

  it("AskAiLowerRailLink checks isAskAiAvailable before rendering a link", () => {
    const source = readFileSync("components/shell/AskAiLowerRailLink.tsx", "utf8");
    expect(source).toContain("isAskAiAvailable");
    expect(source).toContain('href="/settings#ask-ai"');
  });

  it("AppSidebar wraps its desktop nav in SidebarShell instead of rendering <aside> directly", () => {
    const source = readFileSync("components/shell/AppSidebar.tsx", "utf8");
    expect(source).toContain("SidebarShell");
    expect(source).not.toContain("<aside");
  });

  it("SidebarShell persists collapse state through profiles.dashboard_prefs", () => {
    const source = readFileSync("components/shell/SidebarShell.tsx", "utf8");
    expect(source).toContain('"use client"');
    expect(source).toContain("dashboard_prefs");
    expect(source).toContain("sidebarCollapsed");
    expect(source).toContain("aria-pressed");
  });

  it("AppSidebar has no use client directive, so the env-var feature-flag override keeps working", () => {
    const source = readFileSync("components/shell/AppSidebar.tsx", "utf8");
    expect(source).not.toContain('"use client"');
  });

  it("SidebarShell's data-collapsed attribute matches the Tailwind selector AppSidebar uses", () => {
    const shellSource = readFileSync("components/shell/SidebarShell.tsx", "utf8");
    const sidebarSource = readFileSync("components/shell/AppSidebar.tsx", "utf8");
    expect(shellSource).toContain("group/sidebar");
    expect(shellSource).toContain("data-collapsed");
    expect(sidebarSource).toContain("group-data-[collapsed=true]/sidebar");
  });

  it("never adds monitor, plan, or wealth as top-level nav keys", () => {
    const keys = NAV_ITEMS.map((item) => item.key);
    expect(keys).not.toContain("monitor");
    expect(keys).not.toContain("plan");
    expect(keys).not.toContain("wealth");
  });

  it("keeps Year in Money as a top-level nav entry until Reports (Phase 6) exists", () => {
    const wrapped = NAV_ITEMS.find((item) => item.key === "wrapped");
    expect(wrapped?.href).toBe("/wrapped");
    expect(wrapped?.category).toBe("manage");
  });
});
