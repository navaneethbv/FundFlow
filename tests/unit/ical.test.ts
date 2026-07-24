import { describe, expect, it } from "vitest";
import { buildBillsCalendar, type CalendarBill } from "@/lib/ical";

const netflix: CalendarBill = {
  name: "Netflix",
  amount: 15.49,
  itemType: "expense",
  frequency: "monthly",
  nextDate: "2026-07-15",
};

describe("buildBillsCalendar", () => {
  it("produces a valid CRLF-delimited VCALENDAR envelope", () => {
    const ics = buildBillsCalendar({
      bills: [netflix],
      asOf: "2026-07-01",
      horizonDays: 31,
      includeAmounts: false,
    });
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("PRODID:-//FundFlow//EN");
    expect(lines).toContain("X-WR-CALNAME:FundFlow bills");
    expect(lines).toContain("END:VCALENDAR");
    // No bare LF anywhere — every newline is CRLF.
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("honors a custom calendar name", () => {
    const ics = buildBillsCalendar({
      bills: [],
      asOf: "2026-07-01",
      horizonDays: 31,
      includeAmounts: false,
      calendarName: "My bills",
    });
    expect(ics).toContain("X-WR-CALNAME:My bills");
  });

  it("expands weekly occurrences across the horizon inclusively", () => {
    const ics = buildBillsCalendar({
      bills: [
        {
          name: "Gym",
          amount: 10,
          itemType: "expense",
          frequency: "weekly",
          nextDate: "2026-07-01",
        },
      ],
      asOf: "2026-07-01",
      horizonDays: 21,
      includeAmounts: false,
    });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260701");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260708");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260715");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260722");
  });

  it("expands monthly occurrences by calendar month", () => {
    const ics = buildBillsCalendar({
      bills: [netflix],
      asOf: "2026-07-01",
      horizonDays: 92,
      includeAmounts: false,
    });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260715");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260815");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260915");
  });

  it("skips occurrences before asOf when nextDate is stale", () => {
    const ics = buildBillsCalendar({
      bills: [{ ...netflix, nextDate: "2026-06-15" }],
      asOf: "2026-07-01",
      horizonDays: 31,
      includeAmounts: false,
    });
    expect(ics).not.toContain("20260615");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260715");
  });

  it("appends amounts to summaries only when asked", () => {
    const withAmounts = buildBillsCalendar({
      bills: [
        netflix,
        {
          name: "Acme Payroll",
          amount: 2400,
          itemType: "income",
          frequency: "monthly",
          nextDate: "2026-07-10",
        },
      ],
      asOf: "2026-07-01",
      horizonDays: 20,
      includeAmounts: true,
    });
    expect(withAmounts).toContain("SUMMARY:Netflix ($15.49)");
    // formatCurrency's thousands separator must be escaped per RFC 5545.
    expect(withAmounts).toContain("SUMMARY:Acme Payroll (+$2\\,400.00)");

    const without = buildBillsCalendar({
      bills: [netflix],
      asOf: "2026-07-01",
      horizonDays: 20,
      includeAmounts: false,
    });
    expect(without.split("\r\n")).toContain("SUMMARY:Netflix");
  });

  it("escapes backslashes, semicolons, and commas in text", () => {
    const ics = buildBillsCalendar({
      bills: [
        {
          name: "Rent; Apt 4, LLC\\",
          amount: 1500,
          itemType: "expense",
          frequency: "monthly",
          nextDate: "2026-07-05",
        },
      ],
      asOf: "2026-07-01",
      horizonDays: 10,
      includeAmounts: false,
    });
    expect(ics).toContain("SUMMARY:Rent\\; Apt 4\\, LLC\\\\");
  });

  it("emits deterministic UIDs and DTSTAMP so output is pure", () => {
    const build = () =>
      buildBillsCalendar({
        bills: [netflix],
        asOf: "2026-07-01",
        horizonDays: 20,
        includeAmounts: true,
      });
    const ics = build();
    expect(ics).toBe(build());
    expect(ics).toContain("UID:fundflow-netflix-20260715@fundflow");
    expect(ics).toContain("DTSTAMP:20260701T000000Z");
  });

  it("returns a valid empty calendar for no bills", () => {
    const ics = buildBillsCalendar({
      bills: [],
      asOf: "2026-07-01",
      horizonDays: 31,
      includeAmounts: false,
    });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
