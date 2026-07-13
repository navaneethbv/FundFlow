import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings roadmap workflows", () => {
  it("adds settings panels for roadmap-owned tables", () => {
    for (const file of [
      "components/settings/MerchantRulesSection.tsx",
      "components/settings/ManualAccountsSection.tsx",
      "components/notifications/NotificationFeed.tsx",
      "components/notifications/InAppPreferences.tsx",
    ]) {
      expect(existsSync(file), `${file} should exist`).toBe(true);
    }
  });

  it("wires roadmap panels into the settings page", () => {
    const page = readFileSync("app/settings/page.tsx", "utf8");

    expect(page).toContain("MerchantRulesSection");
    expect(page).toContain("ManualAccountsSection");
    expect(page).not.toContain("NotificationsSection");
    expect(page).not.toContain("PlanningPreferencesSection");
    expect(page).toContain('href="/notifications"');
    expect(page).toContain('id="cleanup"');
    expect(page).toContain('id="alerts"');
  });
});
