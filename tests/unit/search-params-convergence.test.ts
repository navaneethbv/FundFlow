import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Next.js 15 searchParams typing convergence (frontend-review R13):
 * Every page route receiving searchParams must type it as a Promise and await it.
 * Multi-value search parameters must safely unpack via firstSearchParam.
 */

function findPageFiles(dir: string): string[] {
  const pages: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("_") || entry === "api") continue;
      pages.push(...findPageFiles(full));
    } else if (entry === "page.tsx") {
      pages.push(full);
    }
  }
  return pages;
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
