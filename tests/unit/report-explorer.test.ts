import { describe, expect, it } from "vitest";
import { buildReportFacets, getAdjacentReportRange, getReportComparisonRange, getReportPresetRange } from "@/lib/report-explorer";
import { defaultReportFilters } from "@/lib/reports";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

describe("viewer-relative report ranges", () => {
  it.each([
    ["this_month", "2028-02-01", "2028-02-29"],
    ["last_month", "2028-01-01", "2028-01-31"],
    ["last_30_days", "2028-01-31", "2028-02-29"],
    ["last_90_days", "2027-12-02", "2028-02-29"],
    ["year_to_date", "2028-01-01", "2028-02-29"],
    ["prior_year", "2027-01-01", "2027-12-31"],
  ] as const)("resolves %s from the supplied viewer date", (preset, start, end) => {
    expect(getReportPresetRange(preset, "2028-02-29")).toEqual({ start, end });
  });

  it("rolls January's prior month into the previous year", () => {
    expect(getReportPresetRange("last_month", "2026-01-01")).toEqual({ start: "2025-12-01", end: "2025-12-31" });
    expect(getReportPresetRange("this_month", "2026-02-01")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it.each(["2026-02-29", "invalid", "2026-13-01", "2026-01-32"])("rejects invalid calendar anchor %s", (today) => {
    expect(getReportPresetRange("this_month", today)).toBeNull();
  });

  it.each([
    [{ start: "2028-03-01", end: "2028-03-31" }, "previous", { start: "2028-02-01", end: "2028-02-29" }],
    [{ start: "2028-02-01", end: "2028-02-29" }, "next", { start: "2028-03-01", end: "2028-03-31" }],
    [{ start: "2028-01-01", end: "2028-03-31" }, "previous", { start: "2027-10-01", end: "2027-12-31" }],
    [{ start: "2028-01-01", end: "2028-12-31" }, "previous", { start: "2027-01-01", end: "2027-12-31" }],
    [{ start: "2027-01-01", end: "2027-12-31" }, "next", { start: "2028-01-01", end: "2028-12-31" }],
    [{ start: "2028-02-27", end: "2028-03-02" }, "previous", { start: "2028-02-22", end: "2028-02-26" }],
    [{ start: "2028-02-27", end: "2028-03-02" }, "next", { start: "2028-03-03", end: "2028-03-07" }],
    [{ start: "2028-02-29", end: "2028-02-29" }, "next", { start: "2028-03-01", end: "2028-03-01" }],
  ] as const)("navigates %j %s without gaps", (range, direction, expected) => {
    expect(getAdjacentReportRange(range, direction)).toEqual(expected);
  });

  it.each([
    { start: "2026-02-30", end: "2026-03-01" },
    { start: "2026-02-01", end: "2026-02-30" },
    { start: "2026-03-01", end: "2026-02-01" },
  ])("rejects invalid ranges %j", (range) => {
    expect(getAdjacentReportRange(range, "previous")).toBeNull();
    expect(getReportComparisonRange({ ...defaultReportFilters("2026-02"), ...range, comparison: "previous_year" })).toBeNull();
  });

  it("uses adjacent calendar periods for comparisons and clamps prior-year leap days", () => {
    const base = defaultReportFilters("2028-02");
    expect(getReportComparisonRange(base)).toBeNull();
    expect(getReportComparisonRange({ ...base, comparison: "none" })).toBeNull();
    expect(getReportComparisonRange({ ...base, comparison: "previous_period" })).toEqual({ start: "2028-01-01", end: "2028-01-31" });
    expect(getReportComparisonRange({ ...base, comparison: "previous_year" })).toEqual({ start: "2027-02-01", end: "2027-02-28" });
    expect(getReportComparisonRange({ ...base, start: "2028-02-29", end: "2028-03-01", comparison: "previous_year" })).toEqual({ start: "2027-02-28", end: "2027-03-01" });
    expect(getReportComparisonRange({ ...defaultReportFilters("2026-12"), comparison: "previous_year" })).toEqual({ start: "2025-12-01", end: "2025-12-31" });
  });

  it("does not emit dates outside four-digit calendar keys", () => {
    expect(getAdjacentReportRange({ start: "9999-12-01", end: "9999-12-31" }, "next")).toBeNull();
    expect(getAdjacentReportRange({ start: "0000-01-01", end: "0000-01-01" }, "previous")).toBeNull();
    expect(getReportPresetRange("prior_year", "0000-01-01")).toBeNull();
    expect(getReportComparisonRange({ ...defaultReportFilters("2028-01"), start: "0000-01-01", end: "0000-01-31", comparison: "previous_year" })).toBeNull();
  });
});

describe("report filter facets", () => {
  const row: CanonicalFinanceTransaction = { id: "row", sourceTransactionId: "source", date: "2028-02-01", signedAmount: 10, flow: "expense", merchant: "Coffee & Co", groupKey: "FOOD_AND_DRINK", categoryKey: "FOOD_AND_DRINK_COFFEE", accountId: "bank", manualAccountId: null, pending: false, source: "plaid" };

  it("uses canonical identities, supplied account labels, stable sorting and case-insensitive deduplication", () => {
    const rows = [row, { ...row, merchant: " coffee & co ", categoryKey: "food_and_drink_coffee" }, { ...row, accountId: null, manualAccountId: "manual", categoryKey: "TRAVEL_OTHER", merchant: "Airline" }, { ...row, accountId: "unknown", merchant: " ", categoryKey: "UNCATEGORIZED" }, { ...row, accountId: null, manualAccountId: null, categoryKey: " " }];
    expect(buildReportFacets(rows, new Map([["bank", "Checking"], ["manual", "Cash"]]))).toEqual({
      accounts: [{ value: "manual", label: "Cash" }, { value: "bank", label: "Checking" }, { value: "unknown", label: "unknown" }],
      categories: [{ value: "FOOD_AND_DRINK_COFFEE", label: "Food and Drink Coffee" }, { value: "TRAVEL_OTHER", label: "Travel Other" }, { value: "UNCATEGORIZED", label: "Unknown" }],
      merchants: [{ value: "Airline", label: "Airline" }, { value: "Coffee & Co", label: "Coffee & Co" }],
    });
  });

  it("returns empty facets for an empty scope and uses ids when account labels are unavailable", () => {
    expect(buildReportFacets([])).toEqual({ accounts: [], categories: [], merchants: [] });
    expect(buildReportFacets([row]).accounts).toEqual([{ value: "bank", label: "bank" }]);
    expect(buildReportFacets([row, { ...row, accountId: "a" }], new Map([["bank", "Same"], ["a", "Same"]])).accounts.map((option) => option.value)).toEqual(["a", "bank"]);
  });
});
