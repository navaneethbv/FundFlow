import { addDays, addMonths } from "@/lib/date-utils";
import { expandStreamsForMonth, type ManualRecurringItemInput, type RecurringStreamInput } from "@/lib/recurring-page";
import type { DashboardData } from "@/lib/dashboard";
import type { RecurringItem } from "@/lib/planning";

/** Adapt the shared occurrence model to the Dashboard's summaries and forecasts. */
export function buildDashboardRecurring(input: {
  streams: RecurringStreamInput[];
  manualItems: ManualRecurringItemInput[];
  scheduled: RecurringItem[];
  month: string;
  today: string;
}) {
  const streams = input.streams.filter(stream => stream.isActive && !stream.dismissedAt && stream.status !== "TOMBSTONED");
  const manualItems = input.manualItems.filter(item => item.enabled);
  const summaries = [
    ...streams.map(stream => ({
      merchant: stream.merchantName?.trim() || stream.description?.trim() || "Unknown",
      amount: Math.abs(stream.userAmount ?? stream.averageAmount ?? stream.lastAmount ?? 0),
      frequency: stream.frequency,
      category: stream.category,
      predictedNextDate: stream.predictedNextDate ?? stream.lastDate ?? stream.firstDate,
      isIncome: stream.streamType === "inflow",
    })),
    ...manualItems.map(item => ({
      merchant: item.name, amount: Math.abs(item.amount), frequency: item.frequency.toUpperCase(),
      category: item.category, predictedNextDate: item.nextDate, isIncome: item.itemType === "income",
    })),
  ];
  const subscriptions = summaries.filter(row => !row.isIncome).toSorted((a,b) => b.amount - a.amount);
  const incomeStreams = summaries.filter(row => row.isIncome).toSorted((a,b) => b.amount - a.amount);
  // Cover all Dashboard forecast horizons, including a short February.
  const occurrences = Array.from({length:4}, (_, index) =>
    expandStreamsForMonth(streams, manualItems, addMonths(`${input.month}-01`, index).slice(0,7), input.today).occurrences,
  ).flat();
  const nextWeekEnd = addDays(input.today, 7);
  const monthOccurrences = occurrences.filter(row => row.dueDate.startsWith(input.month)
    || (input.month === input.today.slice(0, 7) && row.dueDate >= input.today && row.dueDate <= nextWeekEnd));
  const reminderStatuses = { complete: "paid", overdue: "late", upcoming: "expected" } as const;
  const recurringStatuses: DashboardData["recurringStatuses"] = monthOccurrences.map(row => ({
    id: `${row.source}:${row.sourceId}:${row.dueDate}`,
    name: row.merchant,
    amount: row.amount,
    itemType: row.isIncome ? "income" : "expense",
    nextDate: row.dueDate,
    status: reminderStatuses[row.status],
    transactionIds: row.matchedTransactionId ? [row.matchedTransactionId] : [],
    reviewPrompt: null,
  }));
  for (const item of input.scheduled.filter(row => row.nextDate.startsWith(input.month))) {
    recurringStatuses.push({
      ...item, id: `scheduled:${recurringStatuses.length}:${item.nextDate}`,
      status: item.nextDate < input.today ? "late" : "expected", transactionIds: [], reviewPrompt: null,
    });
  }
  recurringStatuses.sort((a,b) => a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name));
  const toItem = (row: typeof occurrences[number]): RecurringItem => ({
    name: row.merchant, amount: row.amount, category: row.category,
    itemType: row.isIncome ? "income" : "expense", nextDate: row.dueDate, frequency: "once",
  });
  return {
    subscriptions, incomeStreams, recurringStatuses,
    items: [...occurrences.map(toItem), ...input.scheduled],
    forecastItems: [...occurrences.filter(row => row.status !== "complete").map(toItem), ...input.scheduled],
  };
}
