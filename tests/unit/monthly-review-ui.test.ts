import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("monthly review UI", () => {
  it("adds a review page and dashboard entry point", () => {
    expect(existsSync("app/review/page.tsx")).toBe(true);

    const review = readFileSync("app/review/page.tsx", "utf8");
    const dashboard = readFileSync("app/dashboard/page.tsx", "utf8");
    const toolbar = readFileSync("components/dashboard/DashboardToolbar.tsx", "utf8");

    // The page's own header title carries the period (V1 shell restructure
    // dropped the separate "Monthly Review" eyebrow label in favor of a
    // single PageHeader title, matching every other page).
    expect(review).toContain("PageHeader");
    expect(review).toContain("formatMonth(data.selectedMonth)} review");
    expect(review).toContain("getDashboardData");
    expect(review).toContain("getGoals");
    expect(dashboard).toContain("DashboardToolbar");
    expect(toolbar).toContain("/review?");
  });
});
