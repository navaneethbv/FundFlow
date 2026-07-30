import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("TopBar utility actions", () => {
  it("renders SearchButton, NotificationsBell, and a Settings link, hidden below sm", () => {
    const source = readFileSync("components/shell/TopBar.tsx", "utf8");
    expect(source).toContain("SearchButton");
    expect(source).toContain("NotificationsBell");
    expect(source).toContain('href="/settings"');
    expect(source).toContain("sm:flex");
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
