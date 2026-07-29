import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import AccountGroup from "@/components/accounts/AccountGroup";
import AccountPreferences, {
  type AccountsPagePreferences,
} from "@/components/accounts/AccountPreferences";
import AccountsFilters, {
  type AccountsFilterValues,
} from "@/components/accounts/AccountsFilters";
import SummaryPanel from "@/components/accounts/SummaryPanel";
import ConnectBankButton from "@/components/ConnectBankButton";
import RefreshButton from "@/components/RefreshButton";
import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import { Landmark } from "@/components/ui/icons";
import {
  applyAccountsPageView,
  buildAccountsPageData,
  compareTextAscending,
  type AccountBalanceSnapshot,
  type AccountGroupKey,
  type UnifiedAccountSummary,
} from "@/lib/accounts-page";
import {
  isHouseholdScope,
  parseFinancialScope,
  scopeQueryUserId,
} from "@/lib/financial-scope";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    scope?: string | string[];
    institution?: string;
    type?: string;
    visibility?: string;
    owner?: string;
    range?: string;
    summary?: string;
  }>;
}

interface PlaidAccountRow {
  id: string;
  user_id: string;
  plaid_item_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | string | null;
  available_balance: number | string | null;
  iso_currency_code: string | null;
  updated_at: string;
}

interface ManualAccountRow {
  id: string;
  user_id: string;
  name: string;
  account_type: string;
  balance: number | string | null;
  include_in_net_worth: boolean;
  updated_at: string;
}

interface SnapshotRow {
  account_id: string | null;
  manual_account_id: string | null;
  snapshot_date: string;
  current_balance: number | string | null;
  available_balance: number | string | null;
  iso_currency_code: string;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function historyStart(range: string | undefined): string {
  const days = range === "90" ? 90 : range === "all" ? 366 : 30;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString().slice(0, 10);
}

function validGroup(value: string | undefined): AccountGroupKey | undefined {
  return ["credit", "cash", "investment", "loan", "other"].includes(
    value ?? "",
  )
    ? (value as AccountGroupKey)
    : undefined;
}

function validVisibility(
  value: string | undefined,
): "visible" | "hidden" | "all" {
  return value === "hidden" || value === "all" ? value : "visible";
}

function accountPreferences(value: unknown): AccountsPagePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const candidate = value as {
    hiddenIds?: unknown;
    order?: unknown;
  };
  return {
    hiddenIds: Array.isArray(candidate.hiddenIds)
      ? candidate.hiddenIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    order: Array.isArray(candidate.order)
      ? candidate.order.filter((id): id is string => typeof id === "string")
      : [],
  };
}

export default async function AccountsPage({
  searchParams,
}: Readonly<PageProps>) {
  if (!isFeatureEnabled("accountsPage")) notFound();

  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: householdRows, error: householdError } = await supabase
    .from("households")
    .select("id");
  if (householdError) throw householdError;
  const visibleHouseholdIds = (householdRows ?? []).map(
    (row) => row.id as string,
  );
  const scope = parseFinancialScope({
    raw: params.scope,
    ownerUserId: user.id,
    visibleHouseholdIds,
  });
  const queryUserId = scopeQueryUserId(scope);

  let accountsQuery = supabase
    .from("accounts")
    .select(
      "id,user_id,plaid_item_id,name,mask,type,subtype,current_balance,available_balance,iso_currency_code,updated_at",
    )
    .order("name");
  let manualQuery = supabase
    .from("manual_accounts")
    .select(
      "id,user_id,name,account_type,balance,include_in_net_worth,updated_at",
    )
    .order("name");
  let snapshotQuery = supabase
    .from("account_balance_snapshots")
    .select(
      "account_id,manual_account_id,snapshot_date,current_balance,available_balance,iso_currency_code",
    )
    .gte("snapshot_date", historyStart(params.range))
    .order("snapshot_date");
  if (queryUserId) {
    accountsQuery = accountsQuery.eq("user_id", queryUserId);
    manualQuery = manualQuery.eq("user_id", queryUserId);
    snapshotQuery = snapshotQuery.eq("user_id", queryUserId);
  }

  const [
    accountsResult,
    manualResult,
    snapshotResult,
    itemResult,
    profileResult,
  ] = await Promise.all([
    accountsQuery,
    manualQuery,
    snapshotQuery,
    supabase
      .from("plaid_items")
      .select("id,institution_name")
      .eq("user_id", user.id),
    supabase
      .from("profiles")
      .select("dashboard_prefs")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  for (const result of [
    accountsResult,
    manualResult,
    snapshotResult,
    itemResult,
    profileResult,
  ]) {
    if (result.error) throw result.error;
  }

  const institutionByItem = new Map(
    (itemResult.data ?? []).map((item) => [
      item.id as string,
      item.institution_name as string | null,
    ]),
  );
  const plaidAccounts = (accountsResult.data ?? []) as PlaidAccountRow[];
  const manualAccounts = (manualResult.data ?? []) as ManualAccountRow[];
  const accounts: UnifiedAccountSummary[] = [
    ...plaidAccounts.map((account) => ({
      id: account.id,
      ownerUserId: account.user_id,
      source: "plaid" as const,
      name: account.name?.trim() || "Account",
      mask: account.mask,
      type: account.type,
      subtype: account.subtype,
      currentBalance: numeric(account.current_balance),
      availableBalance: numeric(account.available_balance),
      currency: account.iso_currency_code?.toUpperCase() || "USD",
      institution: institutionByItem.get(account.plaid_item_id) ?? null,
      updatedAt: account.updated_at,
      includeInNetWorth: true,
    })),
    ...manualAccounts.map((account) => ({
      id: account.id,
      ownerUserId: account.user_id,
      source: "manual" as const,
      name: account.name,
      mask: null,
      type: account.account_type,
      subtype: null,
      currentBalance: numeric(account.balance),
      availableBalance: null,
      currency: "USD",
      institution: null,
      updatedAt: account.updated_at,
      includeInNetWorth: account.include_in_net_worth,
    })),
  ];
  const snapshots: AccountBalanceSnapshot[] = (
    (snapshotResult.data ?? []) as SnapshotRow[]
  ).map((snapshot) => ({
    accountId: snapshot.account_id,
    manualAccountId: snapshot.manual_account_id,
    snapshotDate: snapshot.snapshot_date,
    currentBalance: numeric(snapshot.current_balance),
    availableBalance: numeric(snapshot.available_balance),
    currency: snapshot.iso_currency_code.toUpperCase(),
  }));
  const dashboardPrefs =
    profileResult.data?.dashboard_prefs &&
    typeof profileResult.data.dashboard_prefs === "object" &&
    !Array.isArray(profileResult.data.dashboard_prefs)
      ? (profileResult.data.dashboard_prefs as Record<string, unknown>)
      : {};
  const prefs = accountPreferences(dashboardPrefs.accountsPage);
  const built = buildAccountsPageData(accounts, snapshots, new Date());
  const view = applyAccountsPageView(built, {
    hiddenIds: prefs.hiddenIds,
    order: prefs.order,
    visibility: validVisibility(params.visibility),
    institution: params.institution || undefined,
    groupKey: validGroup(params.type),
    ownerUserId: params.owner || undefined,
  });
  const institutions = [
    ...new Set(
      accounts
        .map((account) => account.institution)
        .filter((institution): institution is string => institution !== null),
    ),
  ].sort(compareTextAscending);
  const ownerOptions = [
    ...new Set(accounts.map((account) => account.ownerUserId)),
  ].map((ownerId) => ({
    value: ownerId,
    label: ownerId === user.id ? "You" : "Household member",
  }));
  const filterValues: AccountsFilterValues = {
    scope: first(params.scope),
    institution: params.institution,
    type: validGroup(params.type),
    visibility: validVisibility(params.visibility),
    owner: params.owner,
    range:
      params.range === "90" || params.range === "all" ? params.range : "30",
    summary: params.summary === "percent" ? "percent" : "totals",
  };
  const allRows = Object.values(built.groups).flatMap((group) => group.rows);

  return (
    <AppShell active="accounts" email={user.email}>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Balance sheet</p>
          <h1 className="display mt-2 text-3xl sm:text-4xl">Accounts</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            See every balance, its freshness, and the daily history FundFlow has
            actually captured.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ConnectBankButton />
          {plaidAccounts.length > 0 && <RefreshButton />}
          <ButtonLink
            href={`/api/export/accounts-csv${
              first(params.scope)
                ? `?scope=${encodeURIComponent(first(params.scope)!)}`
                : ""
            }`}
            size="sm"
          >
            Export CSV
          </ButtonLink>
        </div>
      </header>

      {visibleHouseholdIds.length > 0 && (
        <nav
          aria-label="Financial scope"
          className="flex flex-wrap gap-2 text-sm font-semibold"
        >
          <Link
            href="/accounts"
            aria-current={!isHouseholdScope(scope) ? "page" : undefined}
            className="min-h-11 rounded-field border border-panel-border px-4 py-2.5 focus-visible:outline-2"
          >
            Mine
          </Link>
          <Link
            href={`/accounts?scope=${visibleHouseholdIds[0]}`}
            aria-current={isHouseholdScope(scope) ? "page" : undefined}
            className="min-h-11 rounded-field border border-panel-border px-4 py-2.5 focus-visible:outline-2"
          >
            Household
          </Link>
        </nav>
      )}

      {accounts.length === 0 ? (
        <EmptyState
          icon={<Landmark aria-hidden className="h-5 w-5" />}
          title="No accounts yet"
          description="Connect a bank or add a manual account in Settings to start your balance history."
          action={<ConnectBankButton />}
        />
      ) : (
        <>
          <AccountsFilters
            current={filterValues}
            institutions={institutions}
            householdScope={isHouseholdScope(scope)}
            ownerOptions={ownerOptions}
          />
          <SummaryPanel
            summary={built.summary}
            historyStartsOn={built.historyStartsOn}
            mode={filterValues.summary ?? "totals"}
            query={filterValues}
          />
          <div className="space-y-4">
            {(Object.keys(view.groups) as AccountGroupKey[]).map((key) => (
              <AccountGroup
                key={key}
                groupKey={key}
                group={view.groups[key]}
              />
            ))}
          </div>
          <AccountPreferences
            accounts={allRows.map((row) => ({ id: row.id, name: row.name }))}
            initialPrefs={prefs}
          />
        </>
      )}
    </AppShell>
  );
}
