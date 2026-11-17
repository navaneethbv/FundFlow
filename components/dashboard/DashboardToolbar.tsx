import RouteSelect from "@/components/ui/RouteSelect";
import type { AccountSummary } from "@/lib/dashboard";
import { accountDisplayLabel } from "@/lib/account-label";
import { formatMonth, formatMinutesAgo } from "@/lib/format";
import ConnectBankButton from "@/components/ConnectBankButton";
import RefreshButton from "@/components/RefreshButton";
import ButtonLink from "@/components/ui/ButtonLink";
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
  const href = (accountId: string | undefined, month: string) => withExtraParams(
    dashboardHref({ view: activeView, accountId, month }), extraParams,
  );
  return (
    <section aria-label="Dashboard filters" className="flex flex-wrap items-center gap-2">
      <RouteSelect label="Account filter" value={href(selectedAccountId, selectedMonth)} options={[
        { label: "All accounts", href: href(undefined, selectedMonth) },
        ...accounts.map(account => ({ label: accountDisplayLabel(account.name, account.mask), href: href(account.id, selectedMonth) })),
      ]} />
      <RouteSelect label="Month filter" value={href(selectedAccountId, selectedMonth)} options={
        [...new Set([selectedMonth, ...months])].map(month => ({ label: formatMonth(month), href: href(selectedAccountId, month) }))
      } />
      <details className="min-w-0">
        <summary className="cursor-pointer rounded-field border border-panel-border px-3 py-2 text-sm font-medium focus-visible:outline-2">Manage accounts</summary>
        <div className="mt-2 flex w-64 max-w-full flex-wrap gap-2 rounded-card border border-panel-border bg-panel p-3 shadow-float">
          <ConnectBankButton />
          {hasBanks && <RefreshButton />}
          <ButtonLink href={`/review?month=${selectedMonth}`} size="sm" variant="ghost">Monthly review</ButtonLink>
          {hasBanks && <p className="text-xs text-muted">{itemCount} institutions, synced {formatMinutesAgo(lastSyncAgoMinutes)}</p>}
        </div>
      </details>
    </section>
  );
}
