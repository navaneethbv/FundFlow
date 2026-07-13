import Link from "next/link";
import type { AccountSummary } from "@/lib/dashboard";
import { cn } from "@/lib/cn";
import { formatMinutesAgo } from "@/lib/format";
import ConnectBankButton from "@/components/ConnectBankButton";
import RefreshButton from "@/components/RefreshButton";
import ButtonLink from "@/components/ui/ButtonLink";
import MonthChips from "@/components/dashboard/MonthChips";
import {
  dashboardHref,
  type DashboardView,
} from "@/components/dashboard/dashboard-view";

export default function DashboardToolbar({
  accounts,
  months,
  selectedMonth,
  selectedAccountId,
  activeView,
  hasBanks,
  itemCount,
  lastSyncAgoMinutes,
}: {
  accounts: AccountSummary[];
  months: string[];
  selectedMonth: string;
  selectedAccountId?: string;
  activeView: DashboardView;
  hasBanks: boolean;
  itemCount: number;
  lastSyncAgoMinutes: number | null;
}) {
  return (
    <section className="space-y-3 rounded-card border border-panel-border bg-panel p-3 sm:p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <ConnectBankButton />
          {hasBanks && <RefreshButton />}
          <ButtonLink
            href={`/review?month=${selectedMonth}`}
            size="sm"
            variant="ghost"
          >
            Monthly review
          </ButtonLink>
          {hasBanks && (
            <span className="text-xs font-medium text-muted">
              {itemCount} institution{itemCount === 1 ? "" : "s"}, synced{" "}
              {formatMinutesAgo(lastSyncAgoMinutes)}
            </span>
          )}
        </div>

        {accounts.length > 0 && (
          <nav
            aria-label="Account filter"
            className="flex max-w-full gap-1.5 overflow-x-auto scrollbar-none"
          >
            <Link
              href={dashboardHref({ view: activeView, month: selectedMonth })}
              aria-current={selectedAccountId ? undefined : "page"}
              className={cn(
                "shrink-0 rounded-field border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2",
                selectedAccountId
                  ? "border-panel-border text-muted hover:text-foreground"
                  : "border-accent bg-accent-soft text-accent",
              )}
            >
              All accounts
            </Link>
            {accounts.map((account) => {
              const active = selectedAccountId === account.id;
              return (
                <Link
                  key={account.id}
                  href={dashboardHref({
                    view: activeView,
                    accountId: active ? undefined : account.id,
                    month: selectedMonth,
                  })}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "shrink-0 rounded-field border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2",
                    active
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-panel-border text-muted hover:text-foreground",
                  )}
                >
                  {account.name ?? "Account"}
                  {account.mask ? ` ${account.mask}` : ""}
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      <MonthChips
        months={months}
        selectedMonth={selectedMonth}
        selectedAccountId={selectedAccountId}
        activeView={activeView}
      />
    </section>
  );
}
