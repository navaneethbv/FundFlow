import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPORT_TIMEZONE,
  getWeeklyReportPeriod,
  isWeeklyReportDue,
  normalizeReportTimezone,
} from "@/lib/report-period";

describe("weekly report periods", () => {
  it("returns the previous Monday through Sunday", () => {
    expect(
      getWeeklyReportPeriod(
        new Date("2026-07-13T15:00:00Z"),
        "America/Los_Angeles",
      ),
    ).toEqual({
      start: "2026-07-06",
      end: "2026-07-12",
      previousStart: "2026-06-29",
      previousEnd: "2026-07-05",
    });
  });

  it("uses the most recently completed Sunday from any reference day", () => {
    expect(
      getWeeklyReportPeriod(
        new Date("2026-07-16T18:00:00Z"),
        "America/Los_Angeles",
      ),
    ).toEqual({
      start: "2026-07-06",
      end: "2026-07-12",
      previousStart: "2026-06-29",
      previousEnd: "2026-07-05",
    });
  });

  it("is due only during Monday's target local hour", () => {
    expect(
      isWeeklyReportDue(
        new Date("2026-07-13T15:30:00Z"),
        "America/Los_Angeles",
      ),
    ).toBe(true);
    expect(
      isWeeklyReportDue(
        new Date("2026-07-13T14:59:00Z"),
        "America/Los_Angeles",
      ),
    ).toBe(false);
  });

  it("handles daylight-saving boundaries without shifting report dates", () => {
    expect(
      getWeeklyReportPeriod(
        new Date("2026-03-09T15:15:00Z"),
        "America/Los_Angeles",
      ),
    ).toEqual({
      start: "2026-03-02",
      end: "2026-03-08",
      previousStart: "2026-02-23",
      previousEnd: "2026-03-01",
    });
  });

  it("recognizes Monday in a timezone while UTC is still Sunday", () => {
    expect(
      isWeeklyReportDue(
        new Date("2026-07-12T23:30:00Z"),
        "Asia/Tokyo",
      ),
    ).toBe(true);
  });

  it("supports non-Pacific report periods", () => {
    expect(
      getWeeklyReportPeriod(
        new Date("2026-07-13T12:00:00Z"),
        "Europe/London",
      ).start,
    ).toBe("2026-07-06");
    expect(
      isWeeklyReportDue(
        new Date("2026-07-13T12:00:00Z"),
        "America/New_York",
      ),
    ).toBe(true);
  });

  it("falls back for invalid timezones", () => {
    expect(normalizeReportTimezone("not/a-zone")).toBe(
      DEFAULT_REPORT_TIMEZONE,
    );
    expect(normalizeReportTimezone(null)).toBe(DEFAULT_REPORT_TIMEZONE);
  });
});
