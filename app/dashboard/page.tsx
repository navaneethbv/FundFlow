import AppShell from "@/components/shell/AppShell";
import AutoRefresh from "@/components/AutoRefresh";
import EmptyState from "@/components/ui/EmptyState";
import Tabs from "@/components/ui/Tabs";
import { Landmark } from "@/components/ui/icons";
import ConnectBankButton from "@/components/ConnectBankButton";
import ActionBar from "@/components/dashboard/ActionBar";
import BreakdownsTab from "@/components/dashboard/BreakdownsTab";
import CardCarousel from "@/components/dashboard/CardCarousel";
import CashflowTab from "@/components/dashboard/CashflowTab";
import FreshnessBanner from "@/components/dashboard/FreshnessBanner";
import MonthChips from "@/components/dashboard/MonthChips";
import OverviewTab from "@/components/dashboard/OverviewTab";
import ButtonLink from "@/components/ui/ButtonLink";
import { computeNetWorth, computeSavingsRate } from "@/components/dashboard/metrics";
import { type RecentTransaction } from "@/components/dashboard/RecentActivity";
import { getDashboardData } from "@/lib/dashboard";
import { getCachedDashboardData } from "@/lib/dashboard-cache";
import { getGoals } from "@/lib/goals";
import { formatMonth } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    accountId?: string;
    month?: string;
    tab?: string;
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

function tabUrl(tab: string, selectedAccountId?: string, selectedMonth?: string, itemId?: string) {
  const params = new URLSearchParams({ tab });
  if (selectedAccountId) params.set("accountId", selectedAccountId);
  if (selectedMonth) params.set("month", selectedMonth);
  if (itemId) params.set("itemId", itemId);
  return `/dashboard?${params.toString()}`;
}

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
  const activeTab = params.tab === "breakdowns" || params.tab === "cashflow" ? params.tab : "overview";
  const shellActive = activeTab === "breakdowns" ? "cards" : activeTab === "cashflow" ? "cashflow" : "overview";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const selectedItemId = params.itemId;
  const drillOptions = {
    itemId: selectedItemId,
    drill: { category: params.category, sub: params.sub, merchant: params.merchant },
  };

  const [data, { data: items }, goals] = await Promise.all([
    user
      ? getCachedDashboardData(supabase, user.id, selectedAccountId, selectedMonth, drillOptions)
      : getDashboardData(supabase, selectedAccountId, selectedMonth, undefined, drillOptions),
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

  return (
    <AppShell active={shellActive} email={user?.email}>
      {hasBanks && <AutoRefresh />}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">Overview</p>
          <h1 className="display text-3xl sm:text-4xl">
            {formatMonth(data.selectedMonth)} money map
          </h1>
        </div>
        <ButtonLink href={`/review?month=${data.selectedMonth}`}>
          Monthly review
        </ButtonLink>
      </div>

      <FreshnessBanner brokenBanks={brokenBanks} isStale={data.syncIsStale} />
      <ActionBar
        hasBanks={hasBanks}
        itemCount={plaidItems.length}
        hasBrokenBanks={brokenBanks.length > 0}
        lastSyncAgoMinutes={data.lastSyncAgoMinutes}
      />

      {!hasBanks ? (
        <EmptyState
          icon={<Landmark aria-hidden className="h-5 w-5" />}
          title="No banks connected"
          description="Connect your bank accounts securely with Plaid to analyze spending, subscriptions, and income streams."
          action={<ConnectBankButton />}
        />
      ) : (
        <>
          <CardCarousel
            accounts={data.accounts}
            selectedAccountId={selectedAccountId}
            selectedMonth={selectedMonth}
            activeTab={activeTab}
            extraParams={{ itemId: selectedItemId, category: params.category, sub: params.sub, merchant: params.merchant }}
          />
          <MonthChips
            months={data.availableMonths}
            selectedMonth={data.selectedMonth}
            selectedAccountId={selectedAccountId}
            activeTab={activeTab}
            extraParams={{ itemId: selectedItemId, category: params.category, sub: params.sub, merchant: params.merchant }}
          />
          <Tabs
            items={[
              { label: "Overview", href: tabUrl("overview", selectedAccountId, selectedMonth, selectedItemId), active: activeTab === "overview" },
              { label: "Cards & Banks", href: tabUrl("breakdowns", selectedAccountId, selectedMonth, selectedItemId), active: activeTab === "breakdowns" },
              { label: "Cash Flow Insights", href: tabUrl("cashflow", selectedAccountId, selectedMonth, selectedItemId), active: activeTab === "cashflow" },
            ]}
          />
          {activeTab === "overview" && (
            <OverviewTab
              data={data}
              netWorth={netWorth}
              savingsRate={savingsRate}
              recentTransactions={recentTransactions}
              accountNames={accountNames}
              goals={goals}
              linkParams={{
                tab: activeTab,
                month: selectedMonth,
                accountId: selectedAccountId,
                itemId: selectedItemId,
              }}
              drillQuery={{
                category: params.category,
                sub: params.sub,
                merchant: params.merchant,
              }}
            />
          )}
          {activeTab === "breakdowns" && (
            <BreakdownsTab
              data={data}
              linkParams={{
                tab: activeTab,
                month: selectedMonth,
                accountId: selectedAccountId,
                itemId: selectedItemId,
              }}
            />
          )}
          {activeTab === "cashflow" && (
            <CashflowTab
              data={data}
              linkParams={{
                tab: activeTab,
                month: selectedMonth,
                accountId: selectedAccountId,
                itemId: selectedItemId,
              }}
            />
          )}
        </>
      )}
    </AppShell>
  );
}
