import { describe, expect, it } from "vitest";
import { UNKNOWN_CURRENCY } from "@/lib/format";
import { defaultReportFilters, parseReportFilters, reportFiltersFromSearchParams, reportFiltersToSearchParams, type ReportSearchParams } from "@/lib/reports";

const base = defaultReportFilters("2028-02");
function paramsRecord(params: URLSearchParams): ReportSearchParams {
  return Object.fromEntries([...new Set(params.keys())].map((key) => [key, params.getAll(key)]));
}

describe("optional saved report exploration settings", () => {
  it("round trips interval, comparison, currency, and repeated filters through saved JSON and URLs", () => {
    const report = { ...base, interval: "weekly", comparison: "previous_year", currency: "EUR", accounts: ["a", "b"], merchants: ["A & B"], sort: "amount", direction: "asc" } as const;
    const payload = { ...report, accounts: [...report.accounts], merchants: [...report.merchants] };
    expect(parseReportFilters(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
    expect(reportFiltersFromSearchParams(paramsRecord(reportFiltersToSearchParams(payload)), base)).toEqual(payload);
  });

  it("keeps v1 and v2 payloads without the new optional fields compatible", () => {
    expect(parseReportFilters(base)).toEqual(base);
    expect(parseReportFilters({ ...base, version: 1, sort: undefined, direction: undefined })).toEqual(base);
    expect(reportFiltersFromSearchParams({}, base)).toEqual(base);
  });

  it.each([
    ["interval", "quarterly"], ["interval", null], ["interval", 7],
    ["comparison", "forecast"], ["comparison", null], ["comparison", {}],
    ["currency", "usd"], ["currency", "US"], ["currency", "USD EUR"], ["currency", null], ["currency", 3],
  ])("rejects a malformed stored %s setting (%j) rather than silently changing its meaning", (key, value) => {
    expect(parseReportFilters({ ...base, [key]: value })).toBeNull();
  });

  it.each(["daily", "weekly", "monthly"])("accepts %s intervals", (interval) => {
    expect(parseReportFilters({ ...base, interval })?.interval).toBe(interval);
  });

  it.each(["none", "previous_period", "previous_year"])("accepts %s comparisons", (comparison) => {
    expect(parseReportFilters({ ...base, comparison })?.comparison).toBe(comparison);
  });

  it("preserves the unknown currency bucket", () => {
    const filters = { ...base, currency: UNKNOWN_CURRENCY };
    expect(parseReportFilters(filters)).toEqual(filters);
    expect(reportFiltersFromSearchParams(paramsRecord(reportFiltersToSearchParams(filters)), base)).toEqual(filters);
  });

  it("uses the first scalar URL value and falls back on malformed optional settings", () => {
    const fallback = { ...base, interval: "daily", comparison: "none", currency: "GBP" } as const;
    expect(reportFiltersFromSearchParams({ interval: ["weekly", "daily"], comparison: ["previous_period", "none"], currency: ["EUR", "GBP"] }, fallback)).toMatchObject({ interval: "weekly", comparison: "previous_period", currency: "EUR" });
    expect(reportFiltersFromSearchParams({ interval: "yearly", comparison: "invalid", currency: "x" }, fallback)).toEqual(fallback);
    expect(reportFiltersFromSearchParams({ interval: "yearly", comparison: "invalid", currency: "x" }, base)).toEqual(base);
  });
});
