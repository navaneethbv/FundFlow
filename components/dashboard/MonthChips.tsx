import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatMonth } from "@/lib/format";

export default function MonthChips({
  months,
  selectedMonth,
  selectedAccountId,
  activeTab,
}: {
  months: string[];
  selectedMonth: string;
  selectedAccountId?: string;
  activeTab: string;
}) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:px-0">
      {months.map((month) => {
        const params = new URLSearchParams({ tab: activeTab });
        if (month !== selectedMonth) params.set("month", month);
        if (selectedAccountId) params.set("accountId", selectedAccountId);
        const active = month === selectedMonth;
        return (
          <Link
            key={month}
            href={`/dashboard?${params.toString()}`}
            className={cn(
              "shrink-0 rounded-field border px-3 py-2 text-xs font-bold transition-colors focus-visible:outline-2",
              active
                ? "border-accent bg-accent text-white"
                : "border-panel-border bg-panel text-muted hover:text-foreground",
            )}
          >
            {formatMonth(month)}
          </Link>
        );
      })}
    </div>
  );
}
