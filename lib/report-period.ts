export const DEFAULT_REPORT_TIMEZONE = "America/Los_Angeles";

/**
 * Which cadence a report period represents. The on-demand export serves both:
 * the Review page asks for a `monthly` period, and the Monday cron plus the
 * unparameterised download link use a `weekly` one. Consumers key budget
 * proration and document copy off this so a month of data is never presented
 * as a week.
 */
export type ReportCadence = "weekly" | "monthly";

export interface WeeklyReportPeriod {
  /**
   * Absent is treated as `"weekly"` (the original cadence): only
   * `getMonthlyReportPeriod` ever sets `"monthly"`.
   */
  kind?: ReportCadence;
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
}

interface LocalDateTime {
  date: string;
  weekday: string;
  hour: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function normalizeReportTimezone(
  timezone: string | null | undefined,
): string {
  const candidate = timezone?.trim() || DEFAULT_REPORT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_REPORT_TIMEZONE;
  }
}

function localDateTime(reference: Date, timezone: string): LocalDateTime {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeReportTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const values = new Map(
    formatter
      .formatToParts(reference)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
    // c8 ignore next -- Intl.DateTimeFormat always emits a weekday part
    weekday: values.get("weekday") ?? "Sun",
    // c8 ignore next -- Intl.DateTimeFormat always emits an hour part
    hour: Number(values.get("hour") ?? "0"),
  };
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + days));
  return value.toISOString().slice(0, 10);
}

export function getWeeklyReportPeriod(
  reference: Date,
  timezone: string,
): WeeklyReportPeriod {
  const local = localDateTime(reference, timezone);
  // c8 ignore next -- WEEKDAY_INDEX covers every weekday Intl can emit
  const weekdayIndex = WEEKDAY_INDEX[local.weekday] ?? 0;
  const daysSinceMonday = (weekdayIndex + 6) % 7;
  const end = addDays(local.date, -(daysSinceMonday + 1));
  const start = addDays(end, -6);
  return {
    kind: "weekly",
    start,
    end,
    previousStart: addDays(start, -7),
    previousEnd: addDays(start, -1),
  };
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `"2026-08"` plus `delta` months, pure integer math (no timezone surprises). */
function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const total = year! * 12 + (monthNumber! - 1) + delta;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}

/** Last day of `month` ("YYYY-MM"), from integer parts so a zone cannot shift it. */
function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * A monthly review period for the on-demand PDF export: `month` itself is the
 * report window and the previous month is the comparison baseline, so the
 * "vs last period" figures in the document mean "vs last month".
 *
 * Returns null for anything that is not a calendar-valid `YYYY-MM`, so the
 * export route can answer 400 instead of silently exporting a different month.
 */
export function getMonthlyReportPeriod(month: string): WeeklyReportPeriod | null {
  if (!MONTH_PATTERN.test(month)) return null;
  const previousMonth = addMonths(month, -1);
  return {
    kind: "monthly",
    start: `${month}-01`,
    end: lastDayOfMonth(month),
    previousStart: `${previousMonth}-01`,
    previousEnd: lastDayOfMonth(previousMonth),
  };
}

// The period rolls over at local Monday 00:00 and then stays put for seven
// days, so a report stays owed for the rest of the week. Staying due past the
// target hour is what lets a skipped scheduler run (GitHub Actions cron is
// best-effort and does drop hours) or a failed send catch up on a later run;
// `claimWeeklyDelivery` dedupes on period_start, so a delivered week is
// claimed, not re-sent.
export function isWeeklyReportDue(
  reference: Date,
  timezone: string,
  targetHour = 8,
): boolean {
  const local = localDateTime(reference, timezone);
  if (local.weekday !== "Mon") return true;
  return local.hour >= targetHour;
}
