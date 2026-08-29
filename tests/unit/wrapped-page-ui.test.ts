import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("wrapped page UI", () => {
  const wrapped = readFileSync("app/wrapped/page.tsx", "utf8");

  it("sets the year chips in the mono face", () => {
    expect(wrapped).toMatch(/inline-flex min-h-11 items-center rounded-field bg-accent-soft px-2\.5 text-accent font-mono/);
    expect(wrapped).toMatch(/inline-flex min-h-11 items-center rounded-field px-2\.5 text-muted transition-colors hover:bg-panel-hover hover:text-foreground font-mono/);
  });

  it("sets the highlight-card month and date labels in the mono face", () => {
    const monoMonthSpans = wrapped.match(/className="mt-1 block font-semibold font-mono"/g) ?? [];
    expect(monoMonthSpans).toHaveLength(2); // biggestMonth, quietestMonth
    expect(wrapped).toContain('className="mt-1 block truncate font-semibold"');
    expect(wrapped).toContain('className="block text-xs text-muted font-mono"');
  });

  it("carries the highlight-card money figures inside the privacy-blur hook", () => {
    const dataMoneyMetricValue = wrapped.match(/data-money className="metric-value text-sm"/g) ?? [];
    expect(dataMoneyMetricValue).toHaveLength(3); // biggestMonth, quietestMonth, largestPurchase
  });

  it("leaves StatTile's period-over-period delta untouched, since it is a trend indicator, not a money direction", () => {
    // StatTile.tsx itself is out of scope for this plan — this just documents
    // intent by confirming the page doesn't attempt to override it inline.
    expect(wrapped).not.toContain("viz-pos");
    expect(wrapped).not.toContain("viz-neg");
  });

  it("loads through the paginated canonical projection instead of an unpaginated select", () => {
    expect(wrapped).toContain('from "@/lib/finance-query"');
    expect(wrapped).toContain("loadCanonicalProjection");
    expect(wrapped).toContain("computeYearInMoneyFromProjection");
    expect(wrapped).not.toMatch(/from\("transactions"\)[\s\S]*?\.select\(/);
  });

  it("renders an accessible, test-addressable truncation warning above the recap", () => {
    expect(wrapped).toContain('data-truncated="true"');
    expect(wrapped).toContain('role="alert"');
    expect(wrapped).toContain("this recap is incomplete");
    expect(wrapped).toContain("reached its bounded row limit");
  });
});
