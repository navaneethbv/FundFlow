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
  withExtraParams,
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
  extraParams,
}: Readonly<{
  accounts: AccountSummary[];
  months: string[];
  selectedMonth: string;
  selectedAccountId?: string;
  activeView: DashboardView;
  hasBanks: boolean;
  itemCount: number;
  lastSyncAgoMinutes: number | null;
  extraParams?: Record<string, string | undefined>;
}>) {
  return (
    <section className="space-y-3 rounded-card border border-panel-border bg-panel p-3 sm:p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2 xl:shrink-0">
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
            className="flex min-w-0 max-w-full gap-1.5 overflow-x-auto scrollbar-none"
          >
            <Link
              href={withExtraParams(
                dashboardHref({ view: activeView, month: selectedMonth }),
                extraParams,
              )}
              aria-current={selectedAccountId ? undefined : "true"}
              className={cn(
                "flex min-h-11 shrink-0 items-center rounded-field border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 sm:min-h-0",
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
                  href={withExtraParams(
                    dashboardHref({
                      view: activeView,
                      accountId: active ? undefined : account.id,
                      month: selectedMonth,
                    }),
                    extraParams,
                  )}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center rounded-field border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 sm:min-h-0",
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
        extraParams={extraParams}
      />
    </section>
  );
}
