import Link from "next/link";
import type { BillGrouping, BillPeriod } from "@/lib/planning";
import { formatCurrency, formatDay, formatMonth } from "@/lib/format";
import Panel from "@/components/ui/Panel";

function periodLabel(periodStart: string, grouping: BillGrouping): string {
  if (grouping === "monthly") return formatMonth(periodStart.slice(0, 7));
  return `Week of ${formatDay(periodStart)}`;
}

/**
 * Upcoming bills and paychecks grouped by week or month (user-selected via
 * the ?bills= link toggle — server-rendered, no client JS).
 */
export default function BillCalendar({
  periods,
  grouping,
  weeklyHref,
  monthlyHref,
}: {
  periods: BillPeriod[];
  grouping: BillGrouping;
  weeklyHref: string;
  monthlyHref: string;
}) {
  const toggle = (
    <div className="flex gap-1 text-xs font-semibold">
      {(
        [
          { label: "Weekly", href: weeklyHref, active: grouping === "weekly" },
          { label: "Monthly", href: monthlyHref, active: grouping === "monthly" },
        ] as const
      ).map((option) => (
        <Link
          key={option.label}
          href={option.href}
          aria-current={option.active ? "true" : undefined}
          className={
            option.active
              ? "rounded-field bg-accent-soft px-2.5 py-1 text-accent"
              : "rounded-field px-2.5 py-1 text-muted transition-colors hover:bg-panel-hover hover:text-foreground"
          }
        >
          {option.label}
        </Link>
      ))}
    </div>
  );

  return (
    <Panel title="Bill calendar" eyebrow="What hits when" action={toggle}>
      {periods.length === 0 ? (
        <p className="text-sm text-muted">
          No upcoming recurring bills detected yet. Refresh recurring
          transactions from Settings to populate the calendar.
        </p>
      ) : (
        <div className="space-y-4">
          {periods.map((period) => (
            <div key={period.periodStart}>
              <div className="flex items-baseline justify-between gap-3 border-b border-panel-border pb-1.5">
                <span className="text-sm font-bold">
                  {periodLabel(period.periodStart, grouping)}
                </span>
                <span className="text-xs text-muted">
                  {period.expenseTotal > 0 && (
                    <>out {formatCurrency(period.expenseTotal)}</>
                  )}
                  {period.expenseTotal > 0 && period.incomeTotal > 0 && " · "}
                  {period.incomeTotal > 0 && (
                    <span className="text-success">
                      in {formatCurrency(period.incomeTotal)}
                    </span>
                  )}
                </span>
              </div>
              <ul className="divide-y divide-panel-border/60">
                {period.items.map((item) => (
                  <li
                    key={`${item.nextDate}-${item.name}`}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <span className="min-w-0 flex items-baseline gap-3">
                      <span className="w-12 shrink-0 text-xs font-semibold text-muted">
                        {formatDay(item.nextDate)}
                      </span>
                      <span className="truncate text-sm font-semibold">
                        {item.name}
                      </span>
                    </span>
                    <span
                      className={
                        item.itemType === "income"
                          ? "metric-value text-sm text-success"
                          : "metric-value text-sm"
                      }
                    >
                      {item.itemType === "income" ? "+" : ""}
                      {formatCurrency(item.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
