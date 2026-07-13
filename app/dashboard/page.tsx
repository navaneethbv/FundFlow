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
import { type RecentTransaction } from "@/components/dashboard/RecentActivity";
import { getDashboardData } from "@/lib/dashboard";
import { getCachedDashboardData } from "@/lib/dashboard-cache";
import { dashboardUrl } from "@/lib/drilldown";
import { getGoals } from "@/lib/goals";
import { formatMonth } from "@/lib/format";
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
  }>;
}

type PlaidItem = {
  id: string;
  institution_name: string | null;
  status: string | null;
};

async function getRecentTransactions({
  supabase,
  month,
  accountId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  month: string;
  accountId?: string;
}): Promise<RecentTransaction[]> {
  const start = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const end = `${year}-${String((monthNumber ?? 1) + 1).padStart(2, "0")}-01`;
  const endDate =
    monthNumber === 12 ? `${(year ?? 0) + 1}-01-01` : end;

  let query = supabase
    .from("transactions")
    .select("id, date, amount, iso_currency_code, merchant_name, name, pfc_primary, account_id")
    .gte("date", start)
    .lt("date", endDate)
    .order("date", { ascending: false })
    .order("id", { ascending: true })
    .limit(5);

  if (accountId) query = query.eq("account_id", accountId);

  const { data } = await query;
  return (data ?? []) as RecentTransaction[];
}

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
  const drillOptions = { itemId: selectedItemId, drill: drillQuery };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [data, { data: items }, goals] = await Promise.all([
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
  ]);

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
            />
          )}
          {activeView === "plan" && <PlanView data={data} goals={goals} />}
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
