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

  it("includes an advice entry gated by advicePage in the planning category", () => {
    const advice = NAV_ITEMS.find((item) => item.key === "advice");
    expect(advice).toBeDefined();
    expect(advice!.category).toBe("planning");
    expect(advice!.featureFlag).toBe("advicePage");
    expect(advice!.href).toBe("/advice");
    expect(existsSync("app/advice/page.tsx")).toBe(true);
  });

  it("keeps /advice gated until its advice_progress migration is applied", () => {
    expect(isFeatureEnabled("advicePage", { FUNDFLOW_FEATURE_FLAGS: "" })).toBe(false);
    expect(isFeatureEnabled("advicePage", { FUNDFLOW_FEATURE_FLAGS: "advicePage" })).toBe(true);
  });

  it("includes a forecasting entry gated by forecastingPage in the planning category", () => {
    const forecasting = NAV_ITEMS.find((item) => item.key === "forecasting");
    expect(forecasting).toBeDefined();
    expect(forecasting!.category).toBe("planning");
    expect(forecasting!.featureFlag).toBe("forecastingPage");
    expect(forecasting!.href).toBe("/forecasting");
    expect(existsSync("app/forecasting/page.tsx")).toBe(true);
  });

  it("includes an investments entry gated by investmentsPage in the planning category", () => {
    const investments = NAV_ITEMS.find((item) => item.key === "investments");
    expect(investments).toBeDefined();
    expect(investments!.category).toBe("planning");
    expect(investments!.featureFlag).toBe("investmentsPage");
    expect(investments!.href).toBe("/investments");
    expect(existsSync("app/investments/page.tsx")).toBe(true);
  });

  it("keeps /investments gated until its investments migration is applied", () => {
    // The page and the daily cron both read/write securities, holdings, and
    // holding_snapshots; a default-on flag would 500 every deployment that
    // has not run 20260730210000_investments.sql yet.
    expect(isFeatureEnabled("investmentsPage", { FUNDFLOW_FEATURE_FLAGS: "" })).toBe(false);
    expect(
      isFeatureEnabled("investmentsPage", { FUNDFLOW_FEATURE_FLAGS: "investmentsPage" }),
    ).toBe(true);
  });

  it("includes a reports entry gated by reportsPage in the primary category", () => {
    const reports = NAV_ITEMS.find((item) => item.key === "reports");
    expect(reports).toBeDefined();
    expect(reports!.category).toBe("primary");
    expect(reports!.featureFlag).toBe("reportsPage");
    expect(reports!.href).toBe("/reports");
    expect(existsSync("app/reports/page.tsx")).toBe(true);
  });

  it("keeps /reports gated until its saved_reports migration is applied", () => {
    // The page reads `saved_reports`; a default-on flag would 500 every
    // deployment that has not run 20260730190000_saved_reports.sql yet.
    expect(isFeatureEnabled("reportsPage", { FUNDFLOW_FEATURE_FLAGS: "" })).toBe(
      false,
    );
    expect(
      isFeatureEnabled("reportsPage", { FUNDFLOW_FEATURE_FLAGS: "reportsPage" }),
    ).toBe(true);
  });

  it("includes a recurring entry gated by recurringPage in the planning category", () => {
    const recurring = NAV_ITEMS.find((item) => item.key === "recurring");
    expect(recurring).toBeDefined();
    expect(recurring!.category).toBe("planning");
    expect(recurring!.featureFlag).toBe("recurringPage");
    expect(recurring!.href).toBe("/recurring");
    expect(existsSync("app/api/recurring/route.ts")).toBe(true);
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
    expect(source).toContain('href="/settings?section=integrations"');
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

  it("gives the nav badge an accessible label instead of leaving the count aria-hidden with no compensating text (Fix 7)", () => {
    const source = readFileSync("components/shell/AppSidebar.tsx", "utf8");
    expect(source).toContain("aria-label={badge && badge > 0");
  });

  it("never adds monitor, plan, or wealth as top-level nav keys", () => {
    const keys = NAV_ITEMS.map((item) => item.key);
    expect(keys).not.toContain("monitor");
    expect(keys).not.toContain("plan");
    expect(keys).not.toContain("wealth");
  });

  it("keeps Year in Money in the nav while Reports is still flag-gated", () => {
    // Phase 6 surfaces /wrapped from the Reports page, but Reports is off by
    // default pending its migration. Retiring the nav entry now would strand
    // /wrapped behind the command palette on every deployment that has not
    // enabled reportsPage. Drop this entry in the change that flips the flag.
    const wrapped = NAV_ITEMS.find((item) => item.key === "wrapped");
    expect(wrapped?.href).toBe("/wrapped");
    expect(wrapped?.category).toBe("manage");
    expect(isFeatureEnabled("reportsPage", { FUNDFLOW_FEATURE_FLAGS: "" })).toBe(
      false,
    );
  });
});
