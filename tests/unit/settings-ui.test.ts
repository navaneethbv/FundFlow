import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DashboardPrefs } from "@/components/settings/DashboardPrefsSection";

describe("settings UI restyle", () => {
  it("uses shared panels and keeps sidebar anchors", () => {
    const page = readFileSync("app/settings/page.tsx", "utf8");
    const sections = [
      "components/settings/BanksSection.tsx",
      "components/settings/BudgetsSection.tsx",
      "components/settings/MfaSection.tsx",
      "components/settings/ImportSection.tsx",
      "components/settings/ExportSection.tsx",
      "components/settings/ReportsSection.tsx",
      "components/settings/DangerZone.tsx",
    ].map((file) => readFileSync(file, "utf8"));

    expect(page).toContain('id="budgets"');
    expect(page).toContain('id="reports"');
    for (const source of sections) {
      expect(source).toContain("Panel");
    }
    expect(sections.join("\n")).toContain("Badge");
    expect(sections.join("\n")).toContain("Button");
  });

  it("DashboardPrefs includes an optional sidebarCollapsed flag", () => {
    const prefs: DashboardPrefs = { sidebarCollapsed: true };
    expect(prefs.sidebarCollapsed).toBe(true);
  });
});
