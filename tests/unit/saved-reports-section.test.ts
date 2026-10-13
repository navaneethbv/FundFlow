import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SavedReportsSection from "@/components/reports/SavedReportsSection";
import { defaultReportFilters } from "@/lib/reports";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const current = defaultReportFilters("2028-02");
function render(filters: unknown): string {
  return renderToStaticMarkup(createElement(SavedReportsSection, {
    currentFilters: current,
    reports: [{ id: "saved-report", name: "February spending", report_type: "spending", filters }],
  }));
}
function reportUrl(html: string): URL {
  const href = /href="([^"]+)"/.exec(html)?.[1];
  expect(href).toBeDefined();
  return new URL(href!.replaceAll("&amp;", "&"), "http://example.test");
}

describe("saved report loading validates the persisted schema", () => {
  it("migrates legacy v1 reports before linking, including their date sort defaults", () => {
    const legacy = { ...current, version: 1, sort: undefined, direction: undefined, merchants: ["  Coffee & Co  "] };
    const html = render(legacy);
    const params = reportUrl(html).searchParams;
    expect(params.get("start")).toBe("2028-02-01");
    expect(params.get("end")).toBe("2028-02-29");
    expect(params.get("sort")).toBe("date");
    expect(params.get("dir")).toBe("desc");
    expect(params.getAll("merchant")).toEqual(["Coffee & Co"]);
    expect(params.has("interval")).toBe(false);
    expect(html).not.toContain("saved in an unsupported format");
  });

  it("loads v2 reports with and without optional exploration settings", () => {
    expect(reportUrl(render(current)).searchParams.get("sort")).toBe("date");
    const saved = { ...current, interval: "weekly", comparison: "previous_year", currency: "EUR", accounts: ["bank", "manual"], categories: ["FOOD"], merchants: ["Coffee"], scope: "household", excludePending: true, sort: "amount", direction: "asc" };
    const params = reportUrl(render(saved)).searchParams;
    for (const [key, value] of Object.entries({ interval: "weekly", comparison: "previous_year", currency: "EUR", scope: "household", pending: "exclude", sort: "amount", dir: "asc" })) expect(params.get(key)).toBe(value);
    expect(params.getAll("account")).toEqual(["bank", "manual"]);
    expect(params.getAll("category")).toEqual(["FOOD"]);
    expect(params.getAll("merchant")).toEqual(["Coffee"]);
  });

  it.each([
    ["future schema", { ...current, version: 99 }],
    ["impossible date", { ...current, start: "2028-02-30" }],
    ["inverted range", { ...current, start: "2028-03-01" }],
    ["missing v2 sort", { ...current, sort: undefined }],
    ["invalid interval", { ...current, interval: "quarterly" }],
    ["invalid comparison", { ...current, comparison: "future_period" }],
    ["invalid currency", { ...current, currency: "usd" }],
    ["null optional setting", { ...current, comparison: null }],
    ["malformed list", { ...current, accounts: "bank" }],
    ["partial filters", { start: "2028-02-01", end: "2028-02-29", tab: "spending" }],
    ["null payload", null],
    ["array payload", []],
    ["string payload", "legacy"],
  ])("shows %s as non-loadable without hiding the saved report", (_name, filters) => {
    const html = render(filters);
    expect(html).toContain("February spending");
    expect(html).toContain("saved in an unsupported format");
    expect(html).not.toContain("<a ");
    expect(html).toContain("Rename");
    expect(html).toContain("Delete");
  });
});
