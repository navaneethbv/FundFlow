"use client";

import { formatCurrency } from "@/lib/format";
import type { RecurringOccurrence } from "@/lib/recurring-page";

export default function RecurringCalendar({
  month,
  occurrences,
}: Readonly<{
  month: string;
  occurrences: RecurringOccurrence[];
}>) {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const mIndex = Number(monthStr) - 1;

  const firstDay = new Date(year, mIndex, 1).getDay();
  const daysInMonth = new Date(year, mIndex + 1, 0).getDate();

  const occurrencesByDay = new Map<number, RecurringOccurrence[]>();
  for (const occ of occurrences) {
    const day = Number(occ.dueDate.slice(8, 10));
    const arr = occurrencesByDay.get(day) || [];
    arr.push(occ);
    occurrencesByDay.set(day, arr);
  }

  const cells = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} className="h-24 bg-panel/30 border border-panel-border/50" />);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const items = occurrencesByDay.get(d) || [];
    cells.push(
      <div key={`day-${d}`} className="h-24 p-1.5 border border-panel-border bg-panel flex flex-col justify-between overflow-hidden">
        <span className="text-xs font-semibold text-muted">{d}</span>
        <div className="space-y-1 overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.id}
              className={`rounded px-1.5 py-0.5 text-[0.65rem] font-medium truncate ${
                item.isIncome
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-accent/10 text-accent"
              }`}
            >
              {item.merchant} ({formatCurrency(item.amount)})
            </div>
          ))}
        </div>
      </div>,
    );
  }

  return (
    <div className="rounded-panel border border-panel-border bg-panel overflow-hidden p-4">
      <div className="grid grid-cols-7 text-center text-xs font-bold text-muted mb-2">
        <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells}
      </div>
    </div>
  );
}
