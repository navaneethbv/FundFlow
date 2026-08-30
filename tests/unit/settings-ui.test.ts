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

    // Phase 13 replaced anchor ids with a `section` query param and a real
    // side nav (components/settings/SettingsLayout.tsx) — see
    // settings-nav.test.ts for the section-routing contract.
    expect(page).toContain("SettingsLayout");
    expect(page).toContain("sectionFromParam");
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

  it("keeps /settings gated until its profile_and_tags migration is applied", () => {
    // Profile/Display/Tags read new profiles columns and user_tags; the rest
    // of the page uses tables that already existed and must stay reachable.
    const page = readFileSync("app/settings/page.tsx", "utf8");
    expect(page).toContain("settingsIa");
    expect(page).toContain("migrationDependentSections");
  });

  it("uses an output element for institution health announcements", () => {
    const banks = readFileSync("components/settings/BanksSection.tsx", "utf8");
    expect(banks).toContain("<output");
    expect(banks).not.toContain('role="status"');
  });
});
