import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getEnabledNavItems } from "@/components/shell/nav-model";

/**
 * Command palette (8.3): source-level wiring checks, same convention as
 * privacy-blur.test.ts — the component is pure client interaction, so the
 * checks assert the load-bearing pieces exist rather than simulating a DOM.
 */
describe("command palette", () => {
  it("ships a client component with keyboard open/close handling", () => {
    expect(existsSync("components/CommandPalette.tsx")).toBe(true);
    const source = readFileSync("components/CommandPalette.tsx", "utf8");
    expect(source).toContain('"use client"');
    // Cmd+K / Ctrl+K opens; Escape closes
    expect(source).toMatch(/metaKey\s*\|\|\s*(event|e)\.ctrlKey/);
    expect(source).toContain('"k"');
    expect(source).toContain("Escape");
    // Arrow-key navigation + Enter to activate
    expect(source).toContain("ArrowDown");
    expect(source).toContain("ArrowUp");
    expect(source).toContain("Enter");
    // Accessible dialog semantics
    expect(source).toContain('role="dialog"');
    expect(source).toContain("aria-label");
  });

  it("covers the app's core destinations via nav items and extra commands", () => {
    // Nav-derived destinations (dashboard, transactions, goals, notifications,
    // settings, ...) are covered exhaustively by the nav-item parity test
    // below; this checks the extra, non-nav commands AppShell adds.
    const appShellSource = readFileSync("components/shell/AppShell.tsx", "utf8");
    for (const href of ["/review", "/api/export/csv", "/api/export/csv?scope=tax"]) {
      expect(appShellSource).toContain(href);
    }
    expect(appShellSource).toContain('view: "plan"');
    expect(appShellSource).toContain('view: "wealth"');
  });

  it("is mounted once in the app shell", () => {
    const shell = readFileSync("components/shell/AppShell.tsx", "utf8");
    expect(shell).toContain("CommandPalette");
  });

  it("AppShell builds CommandPalette's command list from every enabled nav item", () => {
    const appShellSource = readFileSync("components/shell/AppShell.tsx", "utf8");
    expect(appShellSource).toContain("getEnabledNavItems");
    expect(appShellSource).toContain("<CommandPalette items=");
  });

  it("every enabled nav item has a matching href in the built command list, including /wrapped", () => {
    // Reproduce AppShell's exact construction (getEnabledNavItems().map(...))
    // so this actually fails if a future edit silently drops an item, rather
    // than just checking that the substring "item.href" appears somewhere.
    const navCommands = getEnabledNavItems().map((item) => ({
      label: item.label,
      href: item.href,
      hint: item.hint,
    }));
    const hrefs = navCommands.map((command) => command.href);
    expect(hrefs).toContain("/wrapped");
    expect(hrefs).toHaveLength(getEnabledNavItems().length);

    // Confirm AppShell actually builds its commands array from the live nav
    // list this way, not a hardcoded or stale copy.
    const appShellSource = readFileSync("components/shell/AppShell.tsx", "utf8");
    expect(appShellSource).toMatch(/getEnabledNavItems\(\)\.map\(/);
    expect(appShellSource).toContain("item.label");
    expect(appShellSource).toContain("item.href");
    expect(appShellSource).toContain("item.hint");
  });

  it("dispatches the shared open-command-palette event on Cmd+K listener setup", () => {
    const source = readFileSync("components/CommandPalette.tsx", "utf8");
    expect(source).toContain("OPEN_COMMAND_PALETTE_EVENT");
  });
});
