import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReportPrintContext from "@/components/reports/ReportPrintContext";
import { defaultReportFilters } from "@/lib/reports";

describe("report print context", () => {
  it("makes date, currency, applied dimensions and row-page scope explicit", () => {
    const html = renderToStaticMarkup(createElement(ReportPrintContext, {
      filters: { ...defaultReportFilters("2026-10"), accounts: ["account-1"], merchants: ["Cafe"], excludePending: true },
      accountNames: new Map([["account-1", "Checking"]]), currency: "EUR", page: 2, total: 120,
    }));
    expect(html).toContain("Oct 1, 2026");
    expect(html).toContain("Oct 31, 2026");
    expect(html).toContain("EUR");
    expect(html).toContain("Checking");
    expect(html).toContain("Cafe");
    expect(html).toContain("Pending excluded");
    expect(html).toContain("Transactions 51–100 of 120");
    expect(html).toContain("Summary covers all matching transactions");
    expect(html).not.toContain("account-1");
  });

  it("clamps the printed page to the rendered transaction page and handles empty reports", () => {
    const render = (total: number) => renderToStaticMarkup(createElement(ReportPrintContext, {
      filters: defaultReportFilters("2026-10"), currency: "USD", page: 9999, total,
    }));
    expect(render(51)).toContain("Transactions 51–51 of 51");
    expect(render(0)).toContain("No matching transactions");
    expect(render(0)).toContain("Pending included");
  });
});
