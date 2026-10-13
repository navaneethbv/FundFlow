import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReportControls, { reportHref } from "@/components/reports/ReportControls";
import { defaultReportFilters, reportFiltersToSearchParams, type ReportFilters } from "@/lib/reports";

const filters: ReportFilters = { ...defaultReportFilters("2028-02"), accounts: ["a", "archived"], categories: ["FOOD"], merchants: ["Coffee"], scope: "household", excludePending: true, sort: "amount", direction: "asc", interval: "weekly", comparison: "previous_year", currency: "EUR" };
const facets = { accounts: [{ value: "a", label: "Checking" }], categories: [{ value: "FOOD", label: "Food" }], merchants: [{ value: "Coffee", label: "Coffee shop" }] };
function render(overrides = {}) { return renderToStaticMarkup(createElement(ReportControls, { filters, today: "2028-02-29", householdId: "household", facets, ...overrides })); }
function hiddenParams(form: string): URLSearchParams {
  const result = new URLSearchParams();
  for (const match of form.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)) {
    result.append(/name="([^"]+)"/.exec(match[0])![1]!, /value="([^"]*)"/.exec(match[0])![1]!.replaceAll("&amp;", "&"));
  }
  return result;
}

describe("report controls", () => {
  it("preserves every committed setting outside each GET form's editable fields", () => {
    const html = render();
    const forms = [...html.matchAll(/<form\b([^>]*)>(.*?)<\/form>/g)];
    expect(forms).toHaveLength(3);
    for (const [label, omitted] of [["Report dates", ["start", "end"]], ["Report selections", ["account", "category", "merchant"]], ["Report analysis settings", ["interval", "comparison"]]] as const) {
      const form = forms.find((match) => match[1]!.includes(`aria-label="${label}"`));
      expect(form, label).toBeDefined();
      const expected = reportFiltersToSearchParams(filters);
      for (const key of omitted) expected.delete(key);
      expect([...hiddenParams(form![2]!).entries()], label).toEqual([...expected.entries()]);
      expect(form![1]).toContain('method="get"');
      expect(form![1]).toContain('action="/reports"');
    }
  });

  it("shows common presets and adjacent periods, named facets and legacy selected values", () => {
    const html = render();
    for (const label of ["This month", "Last month", "Last 30 days", "Last 90 days", "Year to date", "Prior year", "Previous period", "Next period", "Checking", "archived", "Food", "Coffee shop", "Clear selections", "Trend interval", "Compare with"]) expect(html).toContain(label);
    expect(html).toMatch(/<option value="archived" selected="">archived<\/option>/);
    expect(html).toMatch(/<select[^>]*name="account"[^>]*multiple=""/);
  });

  it("keeps settings and resets pagination on links, including encoded merchant names", () => {
    const url = new URL(reportHref({ ...filters, merchants: ["A & B"], ...({ page: 9 } as object) }, { start: "2028-01-01", end: "2028-01-31" }), "http://example.test");
    expect(url.searchParams.get("currency")).toBe("EUR");
    expect(url.searchParams.get("interval")).toBe("weekly");
    expect(url.searchParams.get("comparison")).toBe("previous_year");
    expect(url.searchParams.get("sort")).toBe("amount");
    expect(url.searchParams.getAll("merchant")).toEqual(["A & B"]);
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("supports old callers without supplied viewer date or facets", () => {
    const html = renderToStaticMarkup(createElement(ReportControls, { filters: defaultReportFilters("2028-02") }));
    expect(html).not.toContain("This month");
    expect(html).not.toContain("Clear selections");
    expect(html).toContain('value="monthly" selected=""');
    expect(html).toContain('value="none" selected=""');
  });

  it("keeps saved case-insensitive filter values selected without duplicate options", () => {
    const html = render({ filters: { ...filters, merchants: ["coffee"] } });
    expect(html).toContain('<option value="coffee" selected="">Coffee shop</option>');
    expect(html).not.toContain('<option value="Coffee"');
  });

  it("does not offer invalid out-of-bounds adjacent links", () => {
    const html = render({ filters: { ...filters, start: "9999-12-01", end: "9999-12-31" }, today: "invalid" });
    expect(html).not.toContain("Next period");
    expect(html).not.toContain("This month");
  });
});
