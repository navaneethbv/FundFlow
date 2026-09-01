import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Skip-to-content (frontend-review R5): keyboard users must not tab through
 * the whole sidebar before content. Source-level checks, same convention as
 * command-palette.test.ts — the layout is a server component with inline
 * scripts, so the assertions pin the load-bearing markup rather than a DOM.
 */
describe("skip to content", () => {
  it("root layout renders a skip link as the first body child targeting #main-content", () => {
    const source = readFileSync("app/layout.tsx", "utf8");
    expect(source).toContain('href="#main-content"');
    expect(source).toContain("Skip to content");
    // Visually hidden until focused: the link ships sr-only and becomes
    // visible on keyboard focus.
    expect(source).toMatch(/sr-only[^"]*focus:not-sr-only|focus:not-sr-only/);
    // First child of <body>, before any route content.
    const bodyIndex = source.indexOf("<body");
    const linkIndex = source.indexOf('href="#main-content"');
    expect(bodyIndex).toBeGreaterThan(-1);
    expect(linkIndex).toBeGreaterThan(bodyIndex);
  });

  it("the signed-in shell's <main> is the skip target", () => {
    const source = readFileSync("components/shell/AppShell.tsx", "utf8");
    expect(source).toContain('id="main-content"');
    expect(source).toContain("tabIndex={-1}");
  });

  it("the auth shell's <main> is the skip target", () => {
    const source = readFileSync("components/shell/AuthShell.tsx", "utf8");
    expect(source).toContain('id="main-content"');
    expect(source).toContain("tabIndex={-1}");
  });
});
