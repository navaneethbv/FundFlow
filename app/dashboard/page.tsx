import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import AutoRefresh from "@/components/AutoRefresh";
import EmptyState from "@/components/ui/EmptyState";
import { Landmark } from "@/components/ui/icons";
import ConnectBankButton from "@/components/ConnectBankButton";
import DashboardHeaderActions from "@/components/dashboard/DashboardHeaderActions";
import DashboardToolbar from "@/components/dashboard/DashboardToolbar";
import FreshnessBanner from "@/components/dashboard/FreshnessBanner";
import MonitorView from "@/components/dashboard/MonitorView";
import PlanView from "@/components/dashboard/PlanView";
import PriorityRail from "@/components/dashboard/PriorityRail";
import WealthView from "@/components/dashboard/WealthView";
import { resolveDashboardView } from "@/components/dashboard/dashboard-view";
import OverviewView from "@/components/dashboard/OverviewView";
import DashboardViewTabs from "@/components/dashboard/DashboardViewTabs";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { computeNetWorth, computeSavingsRate } from "@/components/dashboard/metrics";
import { getRecentTransactions } from "@/lib/recent-transactions";
import { getDashboardData } from "@/lib/dashboard";
import { getCachedDashboardData } from "@/lib/dashboard-cache";
import { dashboardUrl } from "@/lib/drilldown";
import { getGoals } from "@/lib/goals";
import { resolveDisplayName, greetingWord } from "@/lib/greeting";
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

export default async function DashboardPage({ searchParams }: Readonly<PageProps>) {
  const params = await searchParams;
  const selectedAccountId = params.accountId;
  const selectedMonth = params.month;
  const selectedItemId = params.itemId;
  // The grid is the landing view only when the flag is on; existing bookmarks
  // to ?view=monitor|plan|wealth keep resolving exactly as before.
  const widgetsEnabled = isFeatureEnabled("dashboardWidgets");
  const activeView = resolveDashboardView(params, widgetsEnabled ? "overview" : "monitor");
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
    .select("dashboard_prefs, display_name, full_name")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const dashboardPrefs = (profileRow?.dashboard_prefs ?? {}) as DashboardPrefs;
  const greetingName = resolveDisplayName({
    displayName: profileRow?.display_name as string | null,
    fullName: profileRow?.full_name as string | null,
    email: user?.email,
  });
  const greeting = greetingWord(new Date().getHours());

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
    userId: dashboardScope === "household" ? undefined : user?.id,
  });
  const accountNames = new Map(
    data.accounts.map((account) => {
      const mask = account.mask ? ` **${account.mask}` : "";
      return [account.id, `${account.name ?? "Account"}${mask}`];
    }),
  );
  const scopeParam = dashboardScope === "household" ? "household" : undefined;
  const linkParams = { view: activeView, month: selectedMonth, accountId: selectedAccountId, itemId: selectedItemId, scope: scopeParam };
  const extraParams = { itemId: selectedItemId, ...drillQuery, scope: scopeParam };

  return (
    <AppShell active={activeView} email={user?.email}>
      {hasBanks && <AutoRefresh />}

      <PageHeader
        title={`Good ${greeting}, ${greetingName}!`}
        actions={<DashboardHeaderActions activeView={activeView} prefsRaw={profileRow?.dashboard_prefs} />}
      />

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
          <DashboardViewTabs
            activeView={activeView}
            withOverview={widgetsEnabled}
            hrefFor={(view) =>
              dashboardUrl({
                view,
                accountId: selectedAccountId,
                month: selectedMonth,
                ...extraParams,
              })
            }
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

          {activeView === "overview" && (
            <OverviewView
              prefsRaw={profileRow?.dashboard_prefs}
              data={data}
              goals={goals}
              recent={recentTransactions}
              accountNames={accountNames}
              accounts={data.accounts}
              userId={user?.id ?? ""}
              household={dashboardScope === "household"}
              month={data.selectedMonth}
            />
          )}
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
                scope: scopeParam,
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
