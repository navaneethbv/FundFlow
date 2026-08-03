import { describe, expect, it } from "vitest";
import { getWeeklyReportPeriod, isWeeklyReportDue } from "@/lib/report-period";

describe("report-period", () => {
  it("computes weekly report period bounds correctly", () => {
    const ref = new Date("2026-07-15T12:00:00Z"); // Wednesday
    const period = getWeeklyReportPeriod(ref, "America/New_York");

    expect(period.start).toBeDefined();
    expect(period.end).toBeDefined();
    expect(period.previousStart).toBeDefined();
    expect(period.previousEnd).toBeDefined();
  });

  it("checks if weekly report is due on Monday vs other days", () => {
    const mondayBefore8 = new Date("2026-07-13T06:00:00Z");
    const mondayAfter8 = new Date("2026-07-13T10:00:00Z");
    const tuesday = new Date("2026-07-14T10:00:00Z");

    expect(isWeeklyReportDue(tuesday, "UTC", 8)).toBe(true);
    expect(isWeeklyReportDue(mondayBefore8, "UTC", 8)).toBe(false);
    expect(isWeeklyReportDue(mondayAfter8, "UTC", 8)).toBe(true);
  });
});
