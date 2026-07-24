import AppShell from "@/components/shell/AppShell";
import AutoRefresh from "@/components/AutoRefresh";
import EmptyState from "@/components/ui/EmptyState";
import Tabs from "@/components/ui/Tabs";
import { Landmark } from "@/components/ui/icons";
import ConnectBankButton from "@/components/ConnectBankButton";
import DashboardToolbar from "@/components/dashboard/DashboardToolbar";
import FreshnessBanner from "@/components/dashboard/FreshnessBanner";
import MonitorView from "@/components/dashboard/MonitorView";
import PlanView from "@/components/dashboard/PlanView";
import PriorityRail from "@/components/dashboard/PriorityRail";
import WealthView from "@/components/dashboard/WealthView";
import { resolveDashboardView } from "@/components/dashboard/dashboard-view";
import { computeNetWorth, computeSavingsRate } from "@/components/dashboard/metrics";
import { getRecentTransactions } from "@/lib/recent-transactions";
import { getDashboardData } from "@/lib/dashboard";
import { getCachedDashboardData } from "@/lib/dashboard-cache";
import { dashboardUrl } from "@/lib/drilldown";
import { getGoals } from "@/lib/goals";
import { formatMonth } from "@/lib/format";
import ScopeChips from "@/components/dashboard/ScopeChips";
import type { DashboardPrefs } from "@/components/settings/DashboardPrefsSection";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    accountId?: string;
    month?: string;
    tab?: string;
    view?: string;
    itemId?: string;
    category?: string;
    sub?: string;
    merchant?: string;
    bills?: string;
    scope?: string;
  }>;
}

type PlaidItem = {
  id: string;
  institution_name: string | null;
  status: string | null;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const selectedAccountId = params.accountId;
  const selectedMonth = params.month;
  const selectedItemId = params.itemId;
  const activeView = resolveDashboardView(params);
  const drillQuery = {
    category: params.category,
    sub: params.sub,
    merchant: params.merchant,
  };
  const dashboardScope: "mine" | "household" =
    params.scope === "household" ? "household" : "mine";
  const drillOptions = {
    itemId: selectedItemId,
    drill: drillQuery,
    scope: dashboardScope,
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [data, { data: items }, goals, { data: householdRows }] = await Promise.all([
    user
      ? getCachedDashboardData(
          supabase,
          user.id,
          selectedAccountId,
          selectedMonth,
          drillOptions,
        )
      : getDashboardData(
          supabase,
          selectedAccountId,
          selectedMonth,
          undefined,
          drillOptions,
        ),
    supabase
      .from("plaid_items")
      .select("id, institution_name, status")
      .order("created_at"),
    getGoals(supabase),
    supabase.from("households").select("id").limit(1),
  ]);
  const hasHousehold = (householdRows ?? []).length > 0;
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("dashboard_prefs")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const dashboardPrefs = (profileRow?.dashboard_prefs ?? {}) as DashboardPrefs;

  const plaidItems = (items ?? []) as PlaidItem[];
  const hasBanks = plaidItems.length > 0;
  const brokenBanks = plaidItems.filter((item) => item.status === "error");
  const netWorth = computeNetWorth(data.accounts);
  const savingsRate = computeSavingsRate(data.currentMonthIncome, data.currentMonthExpenses);
  const budgetRiskCount = data.budgetEnvelopes.filter(
    (budget) => budget.status === "over" || budget.status === "at-risk",
  ).length;
  const recentTransactions = await getRecentTransactions({
    supabase,
    month: data.selectedMonth,
    accountId: selectedAccountId,
  });
  const accountNames = new Map(
    data.accounts.map((account) => [
      account.id,
      `${account.name ?? "Account"}${account.mask ? ` **${account.mask}` : ""}`,
    ]),
  );
  const linkParams = {
    view: activeView,
    month: selectedMonth,
    accountId: selectedAccountId,
    itemId: selectedItemId,
  };
  const extraParams = { itemId: selectedItemId, ...drillQuery };

  return (
    <AppShell active={activeView} email={user?.email}>
      {hasBanks && <AutoRefresh />}

      <header>
        <p className="eyebrow">{formatMonth(data.selectedMonth)}</p>
        <h1 className="display mt-2 text-3xl sm:text-4xl">
          Financial command center
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Monitor today, plan what comes next, and track your balance sheet.
        </p>
      </header>

      <FreshnessBanner brokenBanks={brokenBanks} isStale={data.syncIsStale} />

      {!hasBanks ? (
        <EmptyState
          icon={<Landmark aria-hidden className="h-5 w-5" />}
          title="No banks connected"
          description="Connect your bank accounts securely with Plaid to analyze spending, subscriptions, and income streams."
          action={<ConnectBankButton />}
        />
      ) : (
        <>
          <DashboardToolbar
            accounts={data.accounts}
            months={data.availableMonths}
            selectedMonth={data.selectedMonth}
            selectedAccountId={selectedAccountId}
            activeView={activeView}
            hasBanks={hasBanks}
            itemCount={plaidItems.length}
            lastSyncAgoMinutes={data.lastSyncAgoMinutes}
            extraParams={extraParams}
          />
          <Tabs
            items={(["monitor", "plan", "wealth"] as const).map((view) => ({
              label: view[0]!.toUpperCase() + view.slice(1),
              href: dashboardUrl({
                view,
                accountId: selectedAccountId,
                month: selectedMonth,
                ...extraParams,
              }),
              active: activeView === view,
            }))}
          />

          {hasHousehold && (
            <ScopeChips
              activeView={activeView}
              selectedMonth={selectedMonth}
              selectedAccountId={selectedAccountId}
              selectedItemId={selectedItemId}
              dashboardScope={dashboardScope}
              spendPerPerson={data.spendPerPerson}
            />
          )}

          <PriorityRail
            brokenBankCount={brokenBanks.length}
            isStale={data.syncIsStale}
            lastSyncAgoMinutes={data.lastSyncAgoMinutes}
            lowBalanceRisk={data.cashFlowForecast.lowBalanceRisk}
            budgetCount={data.budgetEnvelopes.length}
            budgetRiskCount={budgetRiskCount}
            anomalyCount={data.spendingAnomalies.length}
          />

          {activeView === "monitor" && (
            <MonitorView
              data={data}
              netWorth={netWorth}
              savingsRate={savingsRate}
              recentTransactions={recentTransactions}
              accountNames={accountNames}
              linkParams={linkParams}
              drillQuery={drillQuery}
              prefs={dashboardPrefs}
            />
          )}
          {activeView === "plan" && (
            <PlanView
              data={data}
              goals={goals}
              billsGrouping={params.bills === "monthly" ? "monthly" : "weekly"}
              billsLinkParams={{
                month: selectedMonth,
                accountId: selectedAccountId,
                itemId: selectedItemId,
              }}
              prefs={dashboardPrefs}
            />
          )}
          {activeView === "wealth" && (
            <WealthView
              data={data}
              selectedAccountId={selectedAccountId}
              selectedMonth={selectedMonth}
              linkParams={linkParams}
              extraParams={extraParams}
            />
          )}
        </>
      )}
    </AppShell>
  );
}
