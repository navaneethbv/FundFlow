import { MerchantAvatar } from "@/components/ui/Avatar";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import DropdownButton from "@/components/ui/DropdownButton";
import { Repeat } from "@/components/ui/icons";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import { formatCurrency } from "@/lib/format";
import { daysUntil, formatDueAnnotation, localDateKey } from "@/lib/format-date";

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
  const end = new Date(`${today}T00:00:00`);
  end.setDate(end.getDate() + 7);
  const endKey = localDateKey(end);
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

const STATUS_TONE: Record<UpcomingRecurringItem["status"], BadgeTone> = {
  paid: "success",
  expected: "neutral",
  late: "danger",
  unusual_amount: "warning",
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
      error={error}
      action={
        <DropdownButton
          label="This month"
          items={[{ label: "Manage recurring", href: "/recurring" }]}
        />
      }
    >
      {upcoming.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-full bg-panel-2 text-muted"
          >
            <Repeat className="h-5 w-5" />
          </span>
          <p className="text-sm font-semibold">Stay on top of your bills</p>
          <p className="text-xs text-muted">Nothing due in the next seven days.</p>
          <ButtonLink href="/recurring" variant="primary" size="sm">
            Manage recurring
          </ButtonLink>
        </div>
      ) : (
        <ul className="space-y-2">
          {upcoming.map((item) => (
            <li
              key={`${item.name}-${item.nextDate}`}
              className="flex items-center gap-3 text-sm"
            >
              <MerchantAvatar name={item.name} size={32} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
              <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
              <span data-money className="whitespace-nowrap tabular-nums text-xs text-muted">
                {formatCurrency(Math.abs(item.amount), currency)} /{" "}
                {formatDueAnnotation(daysUntil(item.nextDate, today))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}
