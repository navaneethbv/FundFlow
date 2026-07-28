import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Privacy blur mode: a TopBar toggle sets data-privacy="blur" on <html>
 * (persisted per device in localStorage), and globals.css blurs every
 * .metric-value — the class already worn by all major amount displays.
 */
describe("privacy blur mode", () => {
  it("ships a client toggle following the ThemeToggle dataset pattern", () => {
    const source = readFileSync("components/PrivacyToggle.tsx", "utf8");
    expect(source).toContain('"use client"');
    expect(source).toContain("dataset.privacy");
    expect(source).toContain("localStorage");
    expect(source).toContain("aria-pressed");
  });

  it("is mounted in the top bar", () => {
    const source = readFileSync("components/shell/TopBar.tsx", "utf8");
    expect(source).toContain("PrivacyToggle");
  });

  it("blurs metric values via a data attribute, never via JS per amount", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/\[data-privacy="blur"\][^{]*\.metric-value[^{]*\{[^}]*blur/);
  });
});
