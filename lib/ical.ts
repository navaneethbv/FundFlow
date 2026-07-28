/**
 * Pure RFC 5545 (iCalendar) builder for the bills feed: expands recurring
 * bills/paychecks into all-day VEVENTs over a horizon. No I/O, and output
 * is fully deterministic (DTSTAMP derives from asOf, UIDs from name+date)
 * so the same inputs always serialize to the same bytes.
 *
 * Date-advance semantics match lib/insights.ts `advance`: weekly +7d,
 * biweekly +14d, monthly +1 calendar month, quarterly +3mo, yearly +12mo.
 */
import { formatCurrency } from "@/lib/format";

export interface CalendarBill {
  name: string;
  amount: number;
  itemType: "income" | "expense";
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
  nextDate: string;
}

const CRLF = "\r\n";

function parseDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const next = parseDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return isoDate(next);
}

function addMonths(date: string, months: number): string {
  const next = parseDate(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return isoDate(next);
}

function advance(date: string, frequency: CalendarBill["frequency"]): string {
  if (frequency === "weekly") return addDays(date, 7);
  if (frequency === "biweekly") return addDays(date, 14);
  if (frequency === "quarterly") return addMonths(date, 3);
  if (frequency === "yearly") return addMonths(date, 12);
  return addMonths(date, 1);
}

/** RFC 5545 TEXT escaping — backslash first, then structural characters. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "bill"
  );
}

function compactDate(date: string): string {
  return date.replace(/-/g, "");
}

export function buildBillsCalendar(input: {
  bills: CalendarBill[];
  asOf: string;
  horizonDays: number;
  includeAmounts: boolean;
  calendarName?: string;
}): string {
  const end = addDays(input.asOf, input.horizonDays);
  const dtstamp = `${compactDate(input.asOf)}T000000Z`;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FundFlow//EN",
    `X-WR-CALNAME:${escapeText(input.calendarName ?? "FundFlow bills")}`,
  ];

  for (const bill of input.bills) {
    let summary = escapeText(bill.name);
    if (input.includeAmounts) {
      const amount = formatCurrency(Math.abs(bill.amount));
      const sign = bill.itemType === "income" ? "+" : "";
      summary += escapeText(` (${sign}${amount})`);
    }

    let cursor = bill.nextDate;
    // Bounded: even a weekly bill over a year-long horizon stays tiny.
    for (let i = 0; i < 500 && cursor <= end; i++) {
      if (cursor >= input.asOf) {
        const day = compactDate(cursor);
        lines.push(
          "BEGIN:VEVENT",
          `UID:fundflow-${slug(bill.name)}-${day}@fundflow`,
          `DTSTAMP:${dtstamp}`,
          `DTSTART;VALUE=DATE:${day}`,
          `SUMMARY:${summary}`,
          "END:VEVENT",
        );
      }
      cursor = advance(cursor, bill.frequency);
    }
  }

  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}
