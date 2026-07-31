import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("UI overhaul primitives and shell", () => {
  it("keeps stat tile text on app tokens instead of chart ink tokens", () => {
    const statTile = readFileSync("components/charts/StatTile.tsx", "utf8");

    expect(statTile).toContain("text-foreground");
    expect(statTile).not.toContain("var(--viz-ink)");
  });

  it("provides the Phase 3 app shell files", () => {
    for (const file of [
      "components/shell/AppShell.tsx",
      "components/shell/AppSidebar.tsx",
      "components/shell/TopBar.tsx",
      "components/shell/AuthShell.tsx",
      "app/goals/page.tsx",
    ]) {
      expect(existsSync(file), `${file} should exist`).toBe(true);
    }
  });

  it("lists every planned sidebar destination with an active state", () => {
    const navSource =
      readFileSync("components/shell/AppSidebar.tsx", "utf8") +
      readFileSync("components/shell/nav-model.ts", "utf8");

    for (const href of [
      "/dashboard",
      "/transactions",
      "/goals",
      "/settings",
    ]) {
      expect(navSource).toContain(`href: "${href}"`);
    }

    expect(navSource).toContain("active");
    expect(navSource).toContain("Manage");
    expect(navSource).toContain("lg:hidden");
  });

  it("keeps primary navigation out of the utility top bar", () => {
    const topBar = readFileSync("components/shell/TopBar.tsx", "utf8");

    // Primary destinations (transactions, goals, dashboard, ...) live only in
    // the sidebar/mobile pill nav. Settings is a utility action (alongside
    // search and notifications), not a primary destination, so it's expected
    // here (Phase 1 IA, Task 4).
    expect(topBar).not.toContain('href="/transactions"');
    expect(topBar).toContain("ThemeToggle");
    expect(topBar).toContain("LogoutButton");
  });

  it("keeps goals protected and dynamic", () => {
    const goalsPage = readFileSync("app/goals/page.tsx", "utf8");

    expect(goalsPage).toContain('export const dynamic = "force-dynamic"');
    expect(goalsPage).toContain("AppShell");
    expect(goalsPage).toContain("GoalsManager");
  });

  it("uses the shared app shell on protected product pages", () => {
    const pages = [
      ["app/dashboard/page.tsx", 'active={activeView}'],
      ["app/transactions/page.tsx", 'active="transactions"'],
      ["app/settings/page.tsx", 'active="settings"'],
      ["app/goals/page.tsx", 'active="goals"'],
    ];

    for (const [file, activeMarker] of pages) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("AppShell");
      expect(source).toContain(activeMarker);
    }

    // Phase 13: anchor ids gave way to a `section` query param + side nav.
    const settings = readFileSync("app/settings/page.tsx", "utf8");
    expect(settings).toContain("SettingsLayout");
  });
});
