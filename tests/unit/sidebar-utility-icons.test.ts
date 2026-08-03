import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Formerly `topbar.test.ts`: these three utility actions moved from a
 * separate top bar into the sidebar's own icon row (V1 shell restructure —
 * there is no top bar left to mount them in).
 */
describe("SidebarUtilityIcons", () => {
  it("renders SearchButton, NotificationsBell, and a Settings link, hidden at narrower widths and while collapsed", () => {
    const source = readFileSync("components/shell/SidebarUtilityIcons.tsx", "utf8");
    expect(source).toContain("SearchButton");
    expect(source).toContain("NotificationsBell");
    expect(source).toContain('href="/settings"');
    expect(source).toContain("lg:flex");
    expect(source).toContain("group-data-[collapsed=true]/sidebar:hidden");
  });

  it("SearchButton dispatches the shared open-command-palette event", () => {
    const source = readFileSync("components/shell/SearchButton.tsx", "utf8");
    expect(source).toContain("OPEN_COMMAND_PALETTE_EVENT");
    expect(source).toContain('"use client"');
  });

  it("NotificationsBell reads the unread count via getUnreadNotificationCount", () => {
    const source = readFileSync("components/shell/NotificationsBell.tsx", "utf8");
    expect(source).toContain("getUnreadNotificationCount");
    expect(source).toContain('href="/notifications"');
  });
});
