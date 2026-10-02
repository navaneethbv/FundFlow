import { addDays, addMonths, parseDate } from "@/lib/date-utils";
export type PaydayCadence = "weekly" | "biweekly" | "semimonthly" | "monthly";
export interface PaydaySettings {
  cadence: PaydayCadence;
  anchorDate: string;
  amount: number;
  day1: number;
  day2: number | null;
}
export function validPaydayDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = parseDate(value);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.getUTCFullYear() <= 9998 &&
    parsed.toISOString().slice(0, 10) === value
  );
}
function validPayAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 10000000 &&
    Math.abs(value * 100 - Math.round(value * 100)) <= 0.000001
  );
}
function validMonthDay(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 31
  );
}
export function parsePaydaySettings(value: unknown): PaydaySettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    !["weekly", "biweekly", "semimonthly", "monthly"].includes(
      String(v.cadence),
    ) ||
    !validPaydayDate(v.anchorDate)
  )
    return null;
  if (!validPayAmount(v.amount)) return null;
  if (!validMonthDay(v.day1)) return null;
  const semi = v.cadence === "semimonthly";
  if (semi && (!validMonthDay(v.day2) || v.day2 === v.day1)) return null;
  return {
    cadence: v.cadence as PaydayCadence,
    anchorDate: v.anchorDate,
    amount: v.amount,
    day1: v.day1,
    day2: semi ? (v.day2 as number) : null,
  };
}
function monthDay(month: string, day: number): string {
  const last = addDays(addMonths(`${month}-01`, 1), -1);
  return `${month}-${String(Math.min(day, Number(last.slice(8, 10)))).padStart(2, "0")}`;
}
/** Explicit user cadence; monthly dates always use the original day, never a clamped prior date. */
export function paydayDates(
  settings: PaydaySettings,
  today: string,
  count = 4,
): string[] {
  if (
    !validPaydayDate(today) ||
    !parsePaydaySettings(settings) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12
  )
    throw new RangeError("Invalid payday schedule");
  const first = today > settings.anchorDate ? today : settings.anchorDate;
  if (settings.cadence === "weekly" || settings.cadence === "biweekly") {
    const days = settings.cadence === "weekly" ? 7 : 14;
    const elapsed =
      (parseDate(first).getTime() - parseDate(settings.anchorDate).getTime()) /
      86400000;
    const start = Math.ceil(elapsed / days);
    return Array.from({ length: count }, (_, index) =>
      addDays(settings.anchorDate, (start + index) * days),
    );
  }
  const dates: string[] = [];
  let offset = 0;
  while (dates.length < count) {
    const month = addMonths(`${first.slice(0, 7)}-01`, offset).slice(0, 7);
    offset += 1;
    const candidates = new Set([monthDay(month, settings.day1)]);
    if (settings.cadence === "semimonthly")
      candidates.add(monthDay(month, settings.day2!));
    dates.push(
      ...[...candidates]
        .filter((date) => date >= first)
        .sort((a, b) => a.localeCompare(b)),
    );
  }
  return dates.slice(0, count);
}
