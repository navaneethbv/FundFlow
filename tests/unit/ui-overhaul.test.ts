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
    const sidebar = readFileSync("components/shell/AppSidebar.tsx", "utf8");

    for (const href of [
      "/dashboard",
      "/transactions",
      "/dashboard?tab=breakdowns",
      "/dashboard?tab=cashflow",
      "/settings#budgets",
      "/goals",
      "/settings#reports",
      "/settings",
    ]) {
      expect(sidebar).toContain(`href: "${href}"`);
    }

    expect(sidebar).toContain("active");
    expect(sidebar).toContain("lg:hidden");
  });

  it("keeps goals protected and dynamic", () => {
    const goalsPage = readFileSync("app/goals/page.tsx", "utf8");

    expect(goalsPage).toContain('export const dynamic = "force-dynamic"');
    expect(goalsPage).toContain("AppShell");
    expect(goalsPage).toContain("GoalsManager");
  });

  it("uses the shared app shell on protected product pages", () => {
    const pages = [
      ["app/dashboard/page.tsx", 'active={shellActive}'],
      ["app/transactions/page.tsx", 'active="transactions"'],
      ["app/settings/page.tsx", 'active="settings"'],
      ["app/goals/page.tsx", 'active="goals"'],
    ];

    for (const [file, activeMarker] of pages) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("AppShell");
      expect(source).toContain(activeMarker);
    }

    const settings = readFileSync("app/settings/page.tsx", "utf8");
    expect(settings).toContain('id="budgets"');
    expect(settings).toContain('id="reports"');
  });
});
