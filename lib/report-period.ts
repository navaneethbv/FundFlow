export const DEFAULT_REPORT_TIMEZONE = "America/Los_Angeles";

export interface WeeklyReportPeriod {
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
    weekday: values.get("weekday") ?? "Sun",
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
  const weekdayIndex = WEEKDAY_INDEX[local.weekday] ?? 0;
  const daysSinceMonday = (weekdayIndex + 6) % 7;
  const end = addDays(local.date, -(daysSinceMonday + 1));
  const start = addDays(end, -6);
  return {
    start,
    end,
    previousStart: addDays(start, -7),
    previousEnd: addDays(start, -1),
  };
}

export function isWeeklyReportDue(
  reference: Date,
  timezone: string,
  targetHour = 8,
): boolean {
  const local = localDateTime(reference, timezone);
  return local.weekday === "Mon" && local.hour === targetHour;
}
