import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { walkFiles } from "../helpers/test-scanner-utils";

/**
 * Per-route metadata (frontend-review R2): every route titles itself, so
 * browser history, tabs, and screen readers carry page context. Scans the
 * route tree — the same source-walk convention the layout checks use.
 */

function collectPageFiles(dir: string): string[] {
  return walkFiles(dir, {
    extensions: ["page.tsx"],
    ignorePrefix: "_",
  }).filter((file) => !file.includes("/api/"));
}

const APP_DIR = "app";
// The root page redirects signed-in users; the root layout owns its title.
const EXCLUDED = [join(APP_DIR, "page.tsx")];

describe("route metadata", () => {
  const pages = collectPageFiles(APP_DIR).filter((p) => !EXCLUDED.includes(p));

  it("finds the route tree (guard against the scan silently matching nothing)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(20);
  });

  it("the root layout defines a title template every route inherits", () => {
    const source = readFileSync(join(APP_DIR, "layout.tsx"), "utf8");
    expect(source).toContain("template: \"%s — FundFlow\"");
    expect(source).toContain("default: \"FundFlow\"");
  });

  it.each(pages)("exports a titled metadata object: %s", (page) => {
    const source = readFileSync(page, "utf8");
    expect(source, `${page} must export metadata`).toMatch(
      /export const metadata(?::\s*Metadata)?\s*=\s*\{/,
    );
    const titleMatch = source.match(/title:\s*"([^"]+)"/);
    expect(titleMatch, `${page} metadata needs a static title`).not.toBeNull();
    expect(titleMatch![1]!.length).toBeGreaterThan(2);
    expect(titleMatch![1]).not.toBe("FundFlow");
  });
});
