import Link from "next/link";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import { formatCurrency } from "@/lib/format";

export interface UpcomingRecurringItem {
  name: string;
  amount: number;
  nextDate: string;
  /**
   * "paid" once a matching transaction has been seen. "unusual_amount" means
   * one was seen but it did not match the expected figure — that is worth
   * surfacing, not collapsing into "paid".
   */
  status: "paid" | "expected" | "late" | "unusual_amount";
}

/** Inclusive `YYYY-MM-DD` window, compared as strings so no timezone shifts it. */
export function withinNextSevenDays(
  items: UpcomingRecurringItem[],
  today: string,
): UpcomingRecurringItem[] {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  const endKey = end.toISOString().slice(0, 10);
  return items
    .filter((item) => item.nextDate >= today && item.nextDate <= endKey)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name));
}

const STATUS_LABEL: Record<UpcomingRecurringItem["status"], string> = {
  paid: "Paid",
  expected: "Due",
  late: "Late",
  unusual_amount: "Check amount",
};

const STATUS_TONE: Record<UpcomingRecurringItem["status"], string> = {
  paid: "var(--viz-good)",
  expected: "var(--viz-ink-2)",
  late: "var(--viz-bad)",
  unusual_amount: "var(--viz-3)",
};

export default function RecurringWidget({
  items,
  today,
  currency,
  error = null,
}: Readonly<{
  items: UpcomingRecurringItem[];
  today: string;
  currency: string;
  error?: string | null;
}>) {
  const upcoming = withinNextSevenDays(items, today);

  return (
    <WidgetShell
      title="Recurring"
      hint="Next seven days"
      error={error}
      empty={upcoming.length === 0 ? "Nothing due in the next seven days." : null}
      action={
        <Link
          href="/recurring"
          className="text-sm font-semibold text-accent hover:underline"
        >
          Open
        </Link>
      }
    >
      <ul className="space-y-2">
        {upcoming.map((item) => (
          <li
            key={`${item.name}-${item.nextDate}`}
            className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
          >
            <span className="min-w-0 truncate font-medium">{item.name}</span>
            <span className="flex items-baseline gap-2">
              {/* The state is spelled out, so the colour is never the only cue. */}
              <span className="text-xs" style={{ color: STATUS_TONE[item.status] }}>
                {STATUS_LABEL[item.status]} {item.nextDate.slice(5)}
              </span>
              <span className="tabular-nums">
                {formatCurrency(Math.abs(item.amount), currency)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </WidgetShell>
  );
}
