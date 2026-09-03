export function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  // c8 ignore next -- value.split("-") always yields at least one element
  const resolvedYear = year ?? 1970;
  return new Date(Date.UTC(resolvedYear, (month ?? 1) - 1, day ?? 1));
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function addMonths(value: string, months: number): string {
  const date = parseDate(value);
  date.setUTCMonth(date.getUTCMonth() + months);
  return isoDate(date);
}

export type RecurrenceFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export function advanceFrequency(
  date: string,
  frequency: RecurrenceFrequency,
): string {
  if (frequency === "weekly") return addDays(date, 7);
  if (frequency === "biweekly") return addDays(date, 14);
  if (frequency === "quarterly") return addMonths(date, 3);
  if (frequency === "yearly") return addMonths(date, 12);
  return addMonths(date, 1);
}

