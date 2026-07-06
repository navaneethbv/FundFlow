import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("global interactive affordances", () => {
  it("uses pointer cursors for enabled controls without applying them to disabled buttons", () => {
    const css = readFileSync("app/globals.css", "utf8");

    expect(css).toContain("button:not(:disabled)");
    expect(css).toContain("cursor: pointer");
    expect(css).toContain("button:disabled");
    expect(css).toContain("cursor: not-allowed");
  });

  it("supports persisted light and dark theme overrides", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const layout = readFileSync("app/layout.tsx", "utf8");
    const toggle = readFileSync("components/ThemeToggle.tsx", "utf8");

    expect(css).toContain(":root[data-theme=\"light\"]");
    expect(css).toContain(":root[data-theme=\"dark\"]");
    expect(layout).toContain("headers");
    expect(layout).toContain("x-nonce");
    expect(layout).toContain("fundflow-theme");
    expect(toggle).toContain("fundflow-theme");
    expect(toggle).toContain("aria-label");
  });
});
