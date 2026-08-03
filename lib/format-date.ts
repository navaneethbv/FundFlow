/**
 * Shared date/time formatting for user-facing UI — humanized dates and
 * relative freshness, replacing the raw ISO strings (`2026-07-14`) the
 * ledger and other lists used to show directly. Every relative function
 * takes `now` explicitly rather than reading the clock itself, so call
 * sites stay testable and this module never calls `new Date()` with no
 * argument.
 *
 * `formatDate` treats a bare `YYYY-MM-DD` value (what transaction dates and
 * month keys are, per the app's date convention) as a calendar date, not an
 * instant: parsing it with `new Date("2026-07-28")` and formatting in the
 * runtime's local timezone can shift it a day backward for any timezone
 * behind UTC, since that string parses as UTC midnight. Parsing the
 * Y/M/D digits directly avoids that drift entirely. A full timestamp (e.g.
 * `updated_at`) *is* a real instant, so it falls through to `Intl`, which
 * correctly renders it in local time.
 */

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** `"2026-07-28"` -> `"Jul 28, 2026"`. Falls back to the raw string if it can't parse. */
export function formatDate(value: string): string {
  const dateOnly = DATE_ONLY_RE.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const monthIndex = Number(month) - 1;
    const monthName = MONTH_ABBR[monthIndex];
    if (monthName) return `${monthName} ${Number(day)}, ${year}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return MONTH_DAY_YEAR.format(date);
}

/** `"2026-07-28T09:00:00Z"` + now -> `"9 hours ago"` / `"3 days ago"` / `"just now"`. */
export function formatRelativeTime(value: string, now: Date): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  const elapsedMs = Math.max(0, now.getTime() - timestamp);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** Monarch's parenthetical annotation style: `"(22 days ago)"`. */
export function formatRelativeAnnotation(value: string, now: Date): string {
  return `(${formatRelativeTime(value, now)})`;
}

/**
 * Days between `value` (a calendar date, `YYYY-MM-DD`) and `today` (same
 * shape). Positive when `value` is in the future. Used for "in 3 days" /
 * "3 days ago" style annotations on a due date, as distinct from
 * `formatRelativeTime`'s instant-based freshness.
 */
export function daysUntil(value: string, today: string): number {
  const target = new Date(`${value}T00:00:00Z`).getTime();
  const from = new Date(`${today}T00:00:00Z`).getTime();
  if (!Number.isFinite(target) || !Number.isFinite(from)) return 0;
  return Math.round((target - from) / 86_400_000);
}

/** `daysUntil` result -> `"in 3 days"` / `"3 days ago"` / `"today"`. */
export function formatDueAnnotation(daysFromToday: number): string {
  if (daysFromToday === 0) return "today";
  if (daysFromToday === 1) return "in 1 day";
  if (daysFromToday > 0) return `in ${daysFromToday} days`;
  const overdue = Math.abs(daysFromToday);
  return overdue === 1 ? "1 day ago" : `${overdue} days ago`;
}
