import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatRelativeTime,
  formatRelativeAnnotation,
  daysUntil,
  formatDueAnnotation,
} from "@/lib/format-date";

describe("formatDate", () => {
  it("formats a bare YYYY-MM-DD as a calendar date, not an instant", () => {
    expect(formatDate("2026-07-28")).toBe("Jul 28, 2026");
  });

  it("never drifts a day backward regardless of the runtime's timezone", () => {
    // A naive `new Date("2026-01-01")` + local-timezone formatting would
    // render "Dec 31, 2025" in any timezone behind UTC. Parsing the digits
    // directly must not have that failure mode.
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDate("2026-12-31")).toBe("Dec 31, 2026");
  });

  it("falls through to Intl formatting for a full timestamp", () => {
    expect(formatDate("2026-07-28T09:00:00.000Z")).toMatch(/2026/);
  });

  it("returns the raw string for something unparseable", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-28T12:00:00Z");

  it("says just now for anything under a minute", () => {
    expect(formatRelativeTime("2026-07-28T11:59:30Z", now)).toBe("just now");
  });

  it("pluralizes minutes, hours, and days correctly", () => {
    expect(formatRelativeTime("2026-07-28T11:59:00Z", now)).toBe("1 minute ago");
    expect(formatRelativeTime("2026-07-28T11:00:00Z", now)).toBe("1 hour ago");
    expect(formatRelativeTime("2026-07-28T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-07-27T12:00:00Z", now)).toBe("1 day ago");
    expect(formatRelativeTime("2026-07-20T12:00:00Z", now)).toBe("8 days ago");
  });

  it("moves to months and years past 30 and 360 days", () => {
    expect(formatRelativeTime("2026-05-01T12:00:00Z", now)).toMatch(/months? ago/);
    expect(formatRelativeTime("2024-01-01T12:00:00Z", now)).toMatch(/years? ago/);
  });

  it("returns unknown for an unparseable value", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("unknown");
  });
});

describe("formatRelativeAnnotation", () => {
  it("wraps the relative time in parens", () => {
    const now = new Date("2026-07-28T12:00:00Z");
    expect(formatRelativeAnnotation("2026-07-06T12:00:00Z", now)).toBe(
      "(22 days ago)",
    );
  });
});

describe("daysUntil", () => {
  it("is positive for a future date", () => {
    expect(daysUntil("2026-07-31", "2026-07-28")).toBe(3);
  });

  it("is negative for a past date", () => {
    expect(daysUntil("2026-07-06", "2026-07-28")).toBe(-22);
  });

  it("is zero for the same date", () => {
    expect(daysUntil("2026-07-28", "2026-07-28")).toBe(0);
  });
});

describe("formatDueAnnotation", () => {
  it("covers today, future, and overdue in both singular and plural", () => {
    expect(formatDueAnnotation(0)).toBe("today");
    expect(formatDueAnnotation(1)).toBe("in 1 day");
    expect(formatDueAnnotation(3)).toBe("in 3 days");
    expect(formatDueAnnotation(-1)).toBe("1 day ago");
    expect(formatDueAnnotation(-22)).toBe("22 days ago");
  });
});
