import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReportSummary } from "@/lib/reports";
import ReportSummaryPanel from "@/components/reports/ReportSummaryPanel";
import ReportRightRail from "@/components/reports/ReportRightRail";

function summary(overrides: Partial<ReportSummary> = {}): ReportSummary {
  return {
    totalTransactions: 42,
    largest: -500,
    averageAbsolute: 87.5,
    totalIncome: 6000,
    totalSpending: 4200,
    firstDate: "2026-07-01",
    lastDate: "2026-07-31",
    ...overrides,
  };
}

describe("ReportSummaryPanel", () => {
  it("puts the value before the uppercase micro-label (value-first anatomy)", () => {
    const html = renderToStaticMarkup(
      createElement(ReportSummaryPanel, { summary: summary(), currency: "USD" }),
    );
    // The metric-value figure must appear in the markup before its label text.
    expect(html.indexOf("$6,000.00")).toBeLessThan(html.indexOf(">Income<"));
  });

  it("colors income green and spending red", () => {
    const html = renderToStaticMarkup(
      createElement(ReportSummaryPanel, { summary: summary(), currency: "USD" }),
    );
    expect(html).toContain("text-success");
    expect(html).toContain("text-danger");
  });

  it("never truncates a financial value", () => {
    const html = renderToStaticMarkup(
      createElement(ReportSummaryPanel, { summary: summary(), currency: "USD" }),
    );
    expect(html).not.toContain("truncate");
    // The value can wrap within its card and scale with a bounded clamp
    // instead of being clipped.
    expect(html).toContain("break-words");
    expect(html).toContain("clamp(");
    expect(html).toContain("tabular-nums");
  });

  it("renders every digit of a ten-plus-integer-digit positive total", () => {
    const html = renderToStaticMarkup(
      createElement(ReportSummaryPanel, {
        summary: summary({ totalIncome: 12_345_678_901.23, totalSpending: 9_876_543_210.98 }),
        currency: "USD",
      }),
    );
    expect(html).toContain("$12,345,678,901.23");
    expect(html).toContain("$9,876,543,210.98");
    // The clamped value uses the same clamp for both, so no value carries a
    // truncation marker and the full string survives to the DOM.
    expect(html).not.toContain("...");
  });

  it("renders negative values with their sign intact", () => {
    const html = renderToStaticMarkup(
      createElement(ReportSummaryPanel, {
        summary: summary({ totalSpending: -2_039_473.29 }),
        currency: "USD",
      }),
    );
    expect(html).toContain("-$2,039,473.29");
  });

  it("handles a long localized value in a non-USD currency", () => {
    const html = renderToStaticMarkup(
      createElement(ReportSummaryPanel, {
        summary: summary({ totalIncome: 1234567890.5 }),
        currency: "EUR",
      }),
    );
    expect(html).toContain("€1,234,567,890.50");
  });
});

describe("ReportRightRail", () => {
  it("renders all seven summary fields plus a Download CSV link", () => {
    const html = renderToStaticMarkup(
      createElement(ReportRightRail, {
        summary: summary(),
        currency: "USD",
        exportHref: "/api/export/report-csv?tab=income",
      }),
    );
    expect(html).toContain("Total transactions");
    expect(html).toContain("Largest");
    expect(html).toContain("Average");
    expect(html).toContain("Total income");
    expect(html).toContain("Total spending");
    expect(html).toContain("First transaction");
    expect(html).toContain("Last transaction");
    expect(html).toContain('href="/api/export/report-csv?tab=income"');
    expect(html).toContain("Download CSV");
  });

  it("shows an em dash instead of a fake date when the range has no transactions", () => {
    const html = renderToStaticMarkup(
      createElement(ReportRightRail, {
        summary: summary({ firstDate: null, lastDate: null, totalTransactions: 0 }),
        currency: "USD",
        exportHref: "/api/export/report-csv",
      }),
    );
    expect(html).toContain("—");
  });
});
