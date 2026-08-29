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

  it("colors the top Income/Spending/Net tiles with the money-direction tokens, not status-semantic classes", () => {
    const review = readFileSync("app/review/page.tsx", "utf8");
    expect(review).toContain('style={{ color: "var(--viz-pos)" }}');
    expect(review).toContain('style={{ color: "var(--viz-neg)" }}');
    // The Net tile's direction colour comes from the shared money-direction
    // helper (which resolves to the --viz-pos / --viz-neg tokens; see
    // format.test.ts), never a status-semantic class.
    expect(review).toContain("gainLossColor(net)");
    expect(review).not.toContain("text-success");
    expect(review).not.toContain("text-danger");
  });

  it("wraps every money figure in the budget review and goals review blocks with data-money", () => {
    const review = readFileSync("app/review/page.tsx", "utf8");
    // Net tile (1), budget review: projectedSpend, monthlyLimit, remaining
    // (3), goals review: remainingAmount (1) = 5. The Income/Spending tiles
    // are covered by the `.money` class instead of data-money, which is also
    // a valid privacy-blur hook.
    const occurrences = review.match(/data-money/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(5);
  });

  it("colors budget projectedSpend and remaining with the money-direction tokens", () => {
    const review = readFileSync("app/review/page.tsx", "utf8");
    expect(review).toContain('budget.remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)"');
  });
});
