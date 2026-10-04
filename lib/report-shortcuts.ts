import { addDays, addMonths } from "@/lib/date-utils";
import { isIsoDate } from "@/lib/reports";

export interface ReportShortcut {
  label: string;
  start: string;
  end: string;
}

/** Calendar shortcuts anchored to the viewer's date, never the server clock. */
export function reportShortcuts(today: string): ReportShortcut[] {
  if (!isIsoDate(today)) throw new Error("A valid viewer date is required");
  const monthStart = `${today.slice(0, 7)}-01`;
  const month = Number(today.slice(5, 7));
  const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const quarterStart = `${today.slice(0, 4)}-${String(quarterMonth).padStart(2, "0")}-01`;
  return [
    { label: "This month", start: monthStart, end: addDays(addMonths(monthStart, 1), -1) },
    { label: "Last month", start: addMonths(monthStart, -1), end: addDays(monthStart, -1) },
    { label: "This quarter", start: quarterStart, end: addDays(addMonths(quarterStart, 3), -1) },
    { label: "Year to date", start: `${today.slice(0, 4)}-01-01`, end: today },
    { label: "Last 6 months", start: addMonths(monthStart, -5), end: today },
  ];
}
