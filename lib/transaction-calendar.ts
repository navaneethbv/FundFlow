export interface CalendarSpendRow {
  date: string;
  amount: number;
  merchant: string;
  id: string;
}

export interface CalendarDay {
  date: string;
  total: number;
  count: number;
  rows: CalendarSpendRow[];
  intensity: number;
}

function daysInMonth(month: string): number {
  const [year, oneBasedMonth] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, oneBasedMonth!, 0)).getUTCDate();
}

export function buildCalendarDays(month: string, rows: readonly CalendarSpendRow[]): CalendarDay[] {
  const grouped = new Map<string, CalendarSpendRow[]>();
  for (const row of rows) {
    if (row.date.startsWith(`${month}-`) && row.amount > 0) {
      const list = grouped.get(row.date) ?? [];
      list.push(row);
      grouped.set(row.date, list);
    }
  }
  const totals = [...grouped.values()].map((day) => day.reduce((sum, row) => sum + row.amount, 0));
  const max = Math.max(0, ...totals);
  return Array.from({ length: daysInMonth(month) }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const dayRows = grouped.get(date) ?? [];
    const total = dayRows.reduce((sum, row) => sum + row.amount, 0);
    return { date, total, count: dayRows.length, rows: dayRows, intensity: max > 0 ? Math.max(1, Math.ceil((total / max) * 7)) : 0 };
  });
}
