import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("notifications center", () => {
  it("is a primary authenticated destination", () => {
    const sidebar = readFileSync("components/shell/AppSidebar.tsx", "utf8");

    expect(sidebar).toContain('href: "/notifications"');
    expect(sidebar).toContain('key: "notifications"');
    expect(existsSync("app/notifications/page.tsx")).toBe(true);
    expect(readFileSync("app/notifications/page.tsx", "utf8")).toContain(
      'active="notifications"',
    );
  });

  it("offers optional email controls and identifies mandatory email", () => {
    const source = readFileSync(
      "components/notifications/EmailPreferences.tsx",
      "utf8",
    );

    expect(source).toContain("Weekly spending report");
    expect(source).toContain("Daily financial digest");
    expect(source).toContain("Always enabled");
    expect(source).toContain("America/Los_Angeles");
    expect(source).toContain("Asia/Kolkata");
  });

  it("keeps critical bank alerts outside editable in-app preferences", () => {
    const source = readFileSync(
      "components/notifications/InAppPreferences.tsx",
      "utf8",
    );

    expect(source).not.toContain('key: "broken_bank"');
    expect(source).toContain("broken_bank: true");
  });
});
