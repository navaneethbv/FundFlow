import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import AddManualHoldingForm from "@/components/investments/AddManualHoldingForm";
import AllocationView from "@/components/investments/AllocationView";
import ConnectedAccounts from "@/components/investments/ConnectedAccounts";
import HoldingsTable from "@/components/investments/HoldingsTable";
import PerformanceChart from "@/components/investments/PerformanceChart";
import TopMovers from "@/components/investments/TopMovers";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatCurrency, gainLossColor, inflowMarker } from "@/lib/format";
import {
  computeTimeWeightedReturn,
  hasSufficientPerformanceData,
} from "@/lib/investment-performance";
import {
  buildInvestmentsPage,
  buildInvestmentAccountCoverage,
  externalFlowsFromTransactions,
} from "@/lib/investments";
import {
  loadHoldingAccountOptions,
  loadHoldings,
  loadHoldingSnapshots,
  loadInvestmentAccounts,
  loadInvestmentSyncStatus,
  loadInvestmentTransactions,
} from "@/lib/investments-data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function InvestmentsPage() {
  if (!isFeatureEnabled("investmentsPage")) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const [
    holdings,
    snapshots,
    accountOptions,
    investmentTransactions,
    investmentAccounts,
    itemStatus,
  ] = await Promise.all([
    loadHoldings(supabase),
    loadHoldingSnapshots(supabase),
    loadHoldingAccountOptions(supabase, user.id),
    loadInvestmentTransactions(supabase),
    loadInvestmentAccounts(supabase, user.id),
    loadInvestmentSyncStatus(supabase, user.id),
  ]);

  const coverage = buildInvestmentAccountCoverage(investmentAccounts, holdings);
  const page = buildInvestmentsPage(holdings, snapshots);
  const needsAttention = itemStatus.filter(
    (item) => item.outcome !== null || item.stale,
  );
  const syncStatusLabel = (item: (typeof itemStatus)[number]) => {
    if (item.outcome) return `Last sync: ${item.outcome}`;
    if (item.stale) return "Stale - no recent holdings sync";
    return "Up to date";
  };
  const itemStatusContent = needsAttention.length > 0 ? (
    <Panel title="Sync status" eyebrow="Investments">
      <ul className="space-y-2 text-sm">
        {needsAttention.map((item) => (
          <li key={item.plaidItemId} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium">{item.institutionName}</span>
            <span className="shrink-0 text-xs text-muted">
              {syncStatusLabel(item)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Holdings are synchronized when the institution provides them. When the provider cannot,
        account balances are used instead — FundFlow never invents holdings or values.
      </p>
    </Panel>
  ) : null;
  const currency = "USD"; // Households and Plaid both settle on USD today; see lib/format's UNKNOWN_CURRENCY fallback elsewhere.
  const externalFlows = externalFlowsFromTransactions(investmentTransactions);
  const returns = hasSufficientPerformanceData(page.balanceHistory)
    ? computeTimeWeightedReturn({
        valuations: page.balanceHistory,
        externalFlows,
      })
    : null;

  const totalDisplay = coverage.total;
  const hasAccounts = coverage.accounts.length > 0;
  const hasHoldings = holdings.some((holding) => holding.isActive);
  let investmentContent: ReactNode;

  if (!hasAccounts) {
    investmentContent = (
      <EmptyState
        headingLevel={2}
        title="No investment accounts yet"
        description="Connect a brokerage through Settings → Banks, or add a manual holding once you have an account to attach it to."
      />
    );
  } else if (!hasHoldings) {
    investmentContent = <ConnectedAccounts coverage={coverage} currency={currency} />;
  } else {
    investmentContent = (
      <div className="space-y-6">
        {coverage.accountsWithoutHoldings > 0 && (
          <ConnectedAccounts coverage={coverage} currency={currency} />
        )}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Panel title="Holdings" className="lg:col-span-2" padding="lg">
            <HoldingsTable page={page} currency={currency} />
          </Panel>
          <div className="space-y-6">
            <Panel title="Allocation" padding="lg">
              <AllocationView page={page} currency={currency} />
            </Panel>
            <Panel title="Performance" padding="lg">
              <PerformanceChart
                balanceHistory={page.balanceHistory}
                returns={returns}
                currency={currency}
              />
            </Panel>
            <Panel title="Top movers" padding="lg">
              <TopMovers movers={page.topMovers} />
            </Panel>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AppShell active="investments" email={user.email}>
      <div className="space-y-6">
        <PageHeader
          title={
            <span className="flex flex-col gap-0.5">
              <span>Investments</span>
              <span className="text-sm font-normal text-muted">
                <span data-money className="money">
                  {formatCurrency(totalDisplay, currency)}
                </span>{" "}
                total
                {page.dayChange && (
                  <span
                    data-money
                    className="ml-2"
                    style={{ color: gainLossColor(page.dayChange.amount) }}
                  >
                    {inflowMarker(page.dayChange.amount)}
                    {formatCurrency(page.dayChange.amount, currency)} (
                    {page.dayChange.pct.toFixed(1)}%) today
                  </span>
                )}
              </span>
            </span>
          }
          actions={
            accountOptions.length > 0 ? (
              <AddManualHoldingForm accounts={accountOptions} />
            ) : null
          }
        />

        {itemStatusContent}

        {investmentContent}
      </div>
    </AppShell>
  );
}
