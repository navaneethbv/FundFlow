import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatMonth } from "@/lib/format";
import {
  dashboardHref,
  resolveDashboardView,
  withExtraParams,
  type DashboardView,
} from "@/components/dashboard/dashboard-view";

export default function MonthChips({
  months,
  selectedMonth,
  selectedAccountId,
  activeView,
  activeTab,
  extraParams,
}: Readonly<{
  months: string[];
  selectedMonth: string;
  selectedAccountId?: string;
  activeView?: DashboardView;
  activeTab?: string;
  extraParams?: Record<string, string | undefined>;
}>) {
  const view = activeView ?? resolveDashboardView({ tab: activeTab });

  return (
    <nav
      aria-label="Month filter"
      className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none"
    >
      {months.map((month) => {
        const active = month === selectedMonth;
        const href = withExtraParams(
          dashboardHref({
            view,
            accountId: selectedAccountId,
            month: active ? undefined : month,
          }),
          extraParams,
        );

        return (
          <Link
            key={month}
            href={href}
            aria-current={active ? "true" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center rounded-field border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 sm:min-h-0",
              active
                ? "border-accent bg-accent text-accent-foreground"
                : "border-panel-border bg-panel text-muted hover:text-foreground",
            )}
          >
            {formatMonth(month)}
          </Link>
        );
      })}
    </nav>
  );
}
