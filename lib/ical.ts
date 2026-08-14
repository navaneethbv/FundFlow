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
  /** Stable stream id, when available — makes VEVENT UIDs collision-free. */
  id?: string;
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

/**
 * RFC 5545 TEXT escaping — backslash first, then structural characters.
 * Bare CR/LF (which would terminate the property line and inject synthetic
 * iCal content) are encoded as the literal two characters `\n`.
 *
 * `:` is deliberately left alone: RFC 5545 §3.3.11 defines TEXT as
 * `*(TSAFE-CHAR / ":" / DQUOTE / ESCAPED-CHAR)`, so a colon is legal bare and
 * `\:` is not one of the four valid escapes. Escaping it makes strict parsers
 * render a literal backslash in names like "Netflix: Premium". The value
 * separator cannot be injected anyway once CR/LF are encoded.
 */
function escapeText(value: string): string {
  return value
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("\r\n", String.raw`\n`)
    .replaceAll("\r", String.raw`\n`)
    .replaceAll("\n", String.raw`\n`)
    .replaceAll(";", String.raw`\;`)
    .replaceAll(",", String.raw`\,`);
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]/gi, "-")
      .replace(/^-|-$/g, "") || "bill"
  );
}

function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

function appendBillEvents(
  lines: string[],
  bill: CalendarBill,
  asOf: string,
  end: string,
  dtstamp: string,
  includeAmounts: boolean,
): void {
  let summary = escapeText(bill.name);
  if (includeAmounts) {
    const amount = formatCurrency(Math.abs(bill.amount));
    const sign = bill.itemType === "income" ? "+" : "";
    summary += escapeText(` (${sign}${amount})`);
  }

  let cursor = bill.nextDate;
  for (let i = 0; i < 500 && cursor <= end; i++) {
    if (cursor >= asOf) {
      const day = compactDate(cursor);
      const key = bill.id ? slug(bill.id) : slug(bill.name);
      lines.push(
        "BEGIN:VEVENT",
        `UID:fundflow-${key}-${day}@fundflow`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${day}`,
        `SUMMARY:${summary}`,
        "END:VEVENT",
      );
    }
    cursor = advance(cursor, bill.frequency);
  }
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
    // Bounded: even a weekly bill over a year-long horizon stays tiny.
    appendBillEvents(lines, bill, input.asOf, end, dtstamp, input.includeAmounts);
  }

  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}
