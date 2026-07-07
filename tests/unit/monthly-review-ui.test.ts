import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("monthly review UI", () => {
  it("adds a review page and dashboard entry point", () => {
    expect(existsSync("app/review/page.tsx")).toBe(true);

    const review = readFileSync("app/review/page.tsx", "utf8");
    const dashboard = readFileSync("app/dashboard/page.tsx", "utf8");

    expect(review).toContain("Monthly Review");
    expect(review).toContain("getDashboardData");
    expect(review).toContain("getGoals");
    expect(dashboard).toContain("/review?");
  });
});
