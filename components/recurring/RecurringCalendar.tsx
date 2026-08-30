"use client";

import { formatCurrency, titleCase } from "@/lib/format";
import type { RecurringOccurrence } from "@/lib/recurring-page";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type CalendarArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export interface CalendarCell {
  day: number;
  date: string;
  inMonth: boolean;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayDelta(key: CalendarArrowKey): number {
  switch (key) {
    case "ArrowLeft":
      return -1;
    case "ArrowRight":
      return 1;
    case "ArrowUp":
      return -7;
    case "ArrowDown":
      return 7;
  }
}

/** Sunday-first month grid with adjacent-month padding cells. */
export function buildMonthGrid(month: string): CalendarCell[][] {
  const parts = month.split("-").map(Number);
  const year = parts[0] ?? 2026;
  const monthIndex = (parts[1] ?? 1) - 1;
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const startOffset = first.getUTCDay();
  const grid: CalendarCell[][] = [];
  let cursor = new Date(Date.UTC(year, monthIndex, 1 - startOffset));
  for (let week = 0; week < 6; week += 1) {
    const row: CalendarCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      row.push({
        day: cursor.getUTCDate(),
        date: dateKey(cursor),
        inMonth: cursor.getUTCMonth() === monthIndex,
      });
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
    grid.push(row);
    if (cursor.getUTCMonth() !== monthIndex) break;
  }
  return grid;
}

/**
 * Roving-tabindex day navigation: ArrowLeft/Right move a day; ArrowUp/Down
 * move a week (7 days). Values clamp to the month's first/last day.
 */
export function moveDayFocus(
  day: number,
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
  firstOfMonth: Date,
  lastOfMonth: Date,
): number {
  const delta = dayDelta(key);
  const next = day + delta;
  return Math.max(firstOfMonth.getUTCDate(), Math.min(lastOfMonth.getUTCDate(), next));
}

function occurrenceTone(occurrence: RecurringOccurrence): string {
  if (occurrence.status === "complete") return "text-success";
  if (occurrence.status === "overdue") return "text-danger";
  if (occurrence.isIncome) return "text-muted";
  return "text-foreground";
}

/**
 * Calendar twin of the Recurring list. Occurrences reuse the month's expanded
 * rows; the view is purely presentational. The grid is keyboard navigable with
 * arrow keys (roving tabindex) and a table lists the same occurrences for
 * screen readers and narrow screens.
 */
export default function RecurringCalendar({
  month,
  today,
  currency,
  occurrences,
}: Readonly<{
  month: string;
  today: string;
  currency: string;
  occurrences: RecurringOccurrence[];
}>) {
  const grid = buildMonthGrid(month);
  const byDate = new Map<string, RecurringOccurrence[]>();
  for (const occurrence of occurrences) {
    const list = byDate.get(occurrence.dueDate) ?? [];
    list.push(occurrence);
    byDate.set(occurrence.dueDate, list);
  }
  const focusDay = today.startsWith(month) ? Number(today.slice(8)) : 1;
  const [year, oneBasedMonth] = month.split("-").map(Number);
  const monthIndex = oneBasedMonth - 1;
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const lastOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0));
  function handleKeyDown(
    day: number,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) {
    const key = event.key as CalendarArrowKey;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return;
    event.preventDefault();
    const next = moveDayFocus(day, key, firstOfMonth, lastOfMonth);
    const nextDate = `${month}-${String(next).padStart(2, "0")}`;
    event.currentTarget
      .closest('[role="grid"]')
      ?.querySelector<HTMLButtonElement>(`button[data-calendar-date="${nextDate}"]`)
      ?.focus();
  }

  const sorted = [...occurrences].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <div>
      <div className="overflow-x-auto" role="grid" aria-label={`Recurring calendar for ${month}`}>
        <div className="min-w-[640px]">
          <div role="row" className="grid grid-cols-7 gap-px bg-panel-border">
            {WEEKDAYS.map((weekday) => (
              <div role="columnheader" key={weekday} className="bg-panel px-2 py-2 text-center text-xs font-semibold text-muted">
                {weekday}
              </div>
            ))}
          </div>
          {grid.map((week) => (
            <div role="row" key={week.map((cell) => cell.date).join("|")} className="grid grid-cols-7 gap-px bg-panel-border">
              {week.map((cell) => {
                const dayOccurrences = byDate.get(cell.date) ?? [];
                const isToday = cell.date === today;
                const isFocus = cell.inMonth && cell.day === focusDay;
                return (
                  <div
                    key={cell.date}
                    role="gridcell"
                    className={`min-h-24 bg-panel p-1.5 ${cell.inMonth ? "" : "opacity-40"}`}
                  >
                    <button
                      data-calendar-date={cell.date}
                      type="button"
                      tabIndex={isFocus ? 0 : -1}
                      onKeyDown={(event) => {
                        handleKeyDown(cell.day, event);
                      }}
                      aria-label={`${cell.date}, ${dayOccurrences.length} occurrence${dayOccurrences.length === 1 ? "" : "s"}`}
                      className={`block w-full rounded-field px-1 text-left text-xs font-semibold outline-none focus-visible:outline-2 ${
                        isToday ? "bg-accent/15 text-accent" : "text-muted"
                      }`}
                    >
                      {cell.day}
                    </button>
                    <ul className="mt-1 space-y-1">
                      {dayOccurrences.slice(0, 3).map((occurrence) => (
                        <li
                          key={`${occurrence.source}-${occurrence.sourceId}`}
                          className="truncate rounded border border-panel-border bg-panel-2 px-1 py-0.5 text-xs"
                          title={`${occurrence.merchant} · ${occurrence.status}`}
                        >
                          <span className={occurrenceTone(occurrence)}>
                            {occurrence.isIncome ? "+" : "−"}
                            {formatCurrency(Math.abs(occurrence.amount), currency)}
                          </span>
                          <span className="block truncate text-muted">{occurrence.merchant}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <h3 className="mt-6 text-sm font-semibold" id="recurring-calendar-list">
        Occurrences this month
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table aria-labelledby="recurring-calendar-list" className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-panel-border">
              <th scope="col" className="px-3 py-2 font-semibold">Date</th>
              <th scope="col" className="px-3 py-2 font-semibold">Merchant</th>
              <th scope="col" className="px-3 py-2 font-semibold">Type</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
              <th scope="col" className="px-3 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((occurrence) => (
              <tr key={`${occurrence.source}-${occurrence.sourceId}`} className="border-b border-panel-border last:border-b-0">
                <td className="px-3 py-2 tabular-nums">{occurrence.dueDate}</td>
                <td className="px-3 py-2">{occurrence.merchant}</td>
                <td className="px-3 py-2">{occurrence.isIncome ? "Income" : "Expense"}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {occurrence.isIncome ? "+" : "−"}{formatCurrency(Math.abs(occurrence.amount), currency)}
                </td>
                <td className="px-3 py-2">{titleCase(occurrence.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
