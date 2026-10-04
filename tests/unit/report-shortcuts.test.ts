import { describe, expect, it } from "vitest";
import { reportShortcuts } from "@/lib/report-shortcuts";
import { dateKeyInTimezone } from "@/lib/report-period";

describe("report period shortcuts", () => {
  it("uses inclusive calendar ranges and explicitly includes the current partial month", () => {
    expect(reportShortcuts("2026-10-03")).toEqual([
      { label: "This month", start: "2026-10-01", end: "2026-10-31" },
      { label: "Last month", start: "2026-09-01", end: "2026-09-30" },
      { label: "This quarter", start: "2026-10-01", end: "2026-12-31" },
      { label: "Year to date", start: "2026-01-01", end: "2026-10-03" },
      { label: "Last 6 months", start: "2026-05-01", end: "2026-10-03" },
    ]);
  });
  it.each([
    ["2024-03-01", "2024-02-01", "2024-02-29"],
    ["2025-03-01", "2025-02-01", "2025-02-28"],
    ["2026-01-01", "2025-12-01", "2025-12-31"],
  ])("handles leap days and year rollover for %s", (today, start, end) => {
    expect(reportShortcuts(today).find((r) => r.label === "Last month")).toMatchObject({ start, end });
  });
  it.each([
    ["2026-01-15", "2026-01-01", "2026-03-31"],
    ["2026-04-01", "2026-04-01", "2026-06-30"],
    ["2026-08-31", "2026-07-01", "2026-09-30"],
    ["2026-12-31", "2026-10-01", "2026-12-31"],
  ])("selects the calendar quarter for %s", (today, start, end) => {
    expect(reportShortcuts(today).find((r) => r.label === "This quarter")).toMatchObject({ start, end });
  });
  it("anchors to the viewer day across the UTC new-year boundary", () => {
    const today = dateKeyInTimezone(new Date("2027-01-01T01:00:00Z"), "America/Los_Angeles");
    expect(reportShortcuts(today).find((r) => r.label === "Year to date")).toMatchObject({ start: "2026-01-01", end: "2026-12-31" });
    expect(reportShortcuts("2026-01-01").find((r) => r.label === "Last 6 months")).toMatchObject({ start: "2025-08-01", end: "2026-01-01" });
  });
  it.each(["invalid", "2026-02-30", "2026-13-01"])("rejects an invalid viewer date: %s", (today) => {
    expect(() => reportShortcuts(today)).toThrow("valid viewer date");
  });
});
