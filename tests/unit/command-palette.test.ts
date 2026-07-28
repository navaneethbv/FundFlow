import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

  it("covers the app's core destinations", () => {
    const source = readFileSync("components/CommandPalette.tsx", "utf8");
    for (const href of [
      "/dashboard",
      "/dashboard?view=plan",
      "/dashboard?view=wealth",
      "/transactions",
      "/goals",
      "/notifications",
      "/settings",
      "/settings#budgets",
      "/review",
      "/api/export/csv",
      "/api/export/csv?scope=tax",
    ]) {
      expect(source).toContain(`"${href}"`);
    }
  });

  it("is mounted once in the app shell", () => {
    const shell = readFileSync("components/shell/AppShell.tsx", "utf8");
    expect(shell).toContain("CommandPalette");
  });
});
