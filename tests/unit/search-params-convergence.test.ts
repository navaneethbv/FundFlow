import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { walkFiles } from "../helpers/test-scanner-utils";

/**
 * Next.js 15 searchParams typing convergence (frontend-review R13):
 * Every page route receiving searchParams must type it as a Promise and await it.
 * Multi-value search parameters must safely unpack via firstSearchParam.
 */

function findPageFiles(dir: string): string[] {
  return walkFiles(dir, {
    extensions: ["page.tsx"],
    ignorePrefix: "_",
  }).filter((file) => !file.includes("/api/"));
}

describe("searchParams Next.js 15 typing convergence", () => {
  const pages = findPageFiles("app");

  it("all pages that consume searchParams type searchParams as a Promise and await it", () => {
    for (const pagePath of pages) {
      const source = readFileSync(pagePath, "utf8");
      if (source.includes("searchParams")) {
        expect(
          source,
          `${pagePath} must type searchParams as Promise<...>`,
        ).toMatch(/searchParams:\s*Promise</);
        expect(
          source,
          `${pagePath} must await searchParams`,
        ).toMatch(/(await\s+searchParams|Promise\.all\(\[[^\]]*searchParams)/);
      }
    }
  });

  it("dashboard, review, wrapped, and settings use firstSearchParam", () => {
    const targetPages = [
      "app/dashboard/page.tsx",
      "app/review/page.tsx",
      "app/wrapped/page.tsx",
      "app/settings/page.tsx",
    ];
    for (const pagePath of targetPages) {
      const source = readFileSync(pagePath, "utf8");
      expect(
        source,
        `${pagePath} should import and use firstSearchParam for safe query string decoding`,
      ).toContain("firstSearchParam");
    }
  });
});
