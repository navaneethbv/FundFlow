import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import AddManualHoldingForm from "@/components/investments/AddManualHoldingForm";
import AllocationView from "@/components/investments/AllocationView";
import HoldingsTable from "@/components/investments/HoldingsTable";
import PerformanceChart from "@/components/investments/PerformanceChart";
import TopMovers from "@/components/investments/TopMovers";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatCurrency, roundsToZero } from "@/lib/format";
import { computeTimeWeightedReturn, hasSufficientPerformanceData } from "@/lib/investment-performance";
import { buildInvestmentsPage, externalFlowsFromTransactions } from "@/lib/investments";
import {
  loadHoldingAccountOptions,
  loadHoldings,
  loadHoldingSnapshots,
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

  const [holdings, snapshots, accountOptions, investmentTransactions] = await Promise.all([
    loadHoldings(supabase),
    loadHoldingSnapshots(supabase),
    loadHoldingAccountOptions(supabase, user.id),
    loadInvestmentTransactions(supabase),
  ]);

  const page = buildInvestmentsPage(holdings, snapshots);
  const currency = "USD"; // Households and Plaid both settle on USD today; see lib/format's UNKNOWN_CURRENCY fallback elsewhere.
  const externalFlows = externalFlowsFromTransactions(investmentTransactions);
  const returns = hasSufficientPerformanceData(page.balanceHistory)
    ? computeTimeWeightedReturn({ valuations: page.balanceHistory, externalFlows })
    : null;

  return (
    <AppShell active="investments" email={user.email}>
      <div className="space-y-6">
        <PageHeader
          title={
            <span className="flex flex-col gap-0.5">
              <span>Investments</span>
              <span className="text-sm font-normal text-muted">
                <span data-money className="money">{formatCurrency(page.total, currency)}</span> total
                {page.dayChange && (
                  <span
                    data-money
                    className="ml-2"
                    style={{ color: roundsToZero(page.dayChange.amount) ? undefined : page.dayChange.amount >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
                  >
                    {roundsToZero(page.dayChange.amount) ? "" : page.dayChange.amount >= 0 ? "+" : ""}
                    {formatCurrency(page.dayChange.amount, currency)} ({page.dayChange.pct.toFixed(1)}%) today
                  </span>
                )}
              </span>
            </span>
          }
          actions={accountOptions.length > 0 ? <AddManualHoldingForm accounts={accountOptions} /> : null}
        />

        {holdings.length === 0 ? (
          <EmptyState
            title="No investment accounts yet"
            description="Connect a brokerage through Settings → Banks, or add a manual holding once you have an account to attach it to."
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Panel title="Holdings" className="lg:col-span-2" padding="lg">
              <HoldingsTable page={page} currency={currency} />
            </Panel>
            <div className="space-y-6">
              <Panel title="Allocation" padding="lg">
                <AllocationView page={page} currency={currency} />
              </Panel>
              <Panel title="Performance" padding="lg">
                <PerformanceChart balanceHistory={page.balanceHistory} returns={returns} currency={currency} />
              </Panel>
              <Panel title="Top movers" padding="lg">
                <TopMovers movers={page.topMovers} />
              </Panel>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
