import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import AccountGroup from "@/components/accounts/AccountGroup";
import AccountPreferences, {
  type AccountsPagePreferences,
} from "@/components/accounts/AccountPreferences";
import AccountsFilters, {
  type AccountsFilterValues,
} from "@/components/accounts/AccountsFilters";
import NetWorthHero from "@/components/accounts/NetWorthHero";
import SummaryPanel from "@/components/accounts/SummaryPanel";
import ConnectBankButton from "@/components/ConnectBankButton";
import RefreshButton from "@/components/RefreshButton";
import EmptyState from "@/components/ui/EmptyState";
import { Landmark } from "@/components/ui/icons";
import {
  accountsViewIsFiltered,
  applyAccountsPageView,
  buildAccountsPageData,
  compareTextAscending,
  type AccountBalanceSnapshot,
  type AccountGroupKey,
  type AccountsPageViewOptions,
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

type AccountNumericValue = number | string | null;

type PlaidAccountRow = {
  id: string;
  user_id: string;
  plaid_item_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: AccountNumericValue;
  available_balance: AccountNumericValue;
  iso_currency_code: string | null;
  updated_at: string;
};

type ManualAccountRow = {
  id: string;
  user_id: string;
  name: string;
  account_type: string;
  balance: AccountNumericValue;
  include_in_net_worth: boolean;
  updated_at: string;
};

interface SnapshotRow {
  account_id: string | null;
  manual_account_id: string | null;
  snapshot_date: string;
  current_balance: AccountNumericValue;
  available_balance: AccountNumericValue;
  iso_currency_code: string;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function numeric(value: AccountNumericValue): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The snapshot read is deliberately bounded. Snapshots accrue one row per
 * account per day forever, so the longest option is a stated 12 months rather
 * than an unbounded "all" — see the frugality invariants in CLAUDE.md.
 */
function historyStart(range: string | undefined): string {
  let days = 30;
  if (range === "90") days = 90;
  if (range === "365") days = 365;
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

function assertQueryResults(
  results: Array<{ error: { message?: string } | null }>,
): void {
  for (const result of results) {
    if (result.error) throw result.error;
  }
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
    supabase.rpc("visible_institutions"),
    supabase
      .from("profiles")
      .select("dashboard_prefs")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  assertQueryResults([
    accountsResult,
    manualResult,
    snapshotResult,
    itemResult,
    profileResult,
  ]);

  const institutionByItem = new Map(
    ((itemResult.data ?? []) as Array<{
      id: string;
      institution_name: string | null;
      institution_logo: string | null;
      institution_brand_color: string | null;
    }>).map((item) => [
      item.id,
      {
        name: item.institution_name,
        logo: item.institution_logo,
        brandColor: item.institution_brand_color,
      },
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
      institution: institutionByItem.get(account.plaid_item_id)?.name ?? null,
      institutionLogo: institutionByItem.get(account.plaid_item_id)?.logo ?? null,
      institutionBrandColor:
        institutionByItem.get(account.plaid_item_id)?.brandColor ?? null,
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
      institutionLogo: null,
      institutionBrandColor: null,
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
  const viewOptions: AccountsPageViewOptions = {
    hiddenIds: prefs.hiddenIds,
    order: prefs.order,
    visibility: validVisibility(params.visibility),
    institution: params.institution || undefined,
    groupKey: validGroup(params.type),
    ownerUserId: params.owner || undefined,
  };
  const view = applyAccountsPageView(built, viewOptions);
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
      params.range === "90" || params.range === "365" ? params.range : "30",
    summary: params.summary === "percent" ? "percent" : "totals",
  };
  const allRows = Object.values(built.groups).flatMap((group) => group.rows);
  const exportHref = `/api/export/accounts-csv${
    first(params.scope) ? `?scope=${encodeURIComponent(first(params.scope)!)}` : ""
  }`;

  return (
    <AppShell active="accounts" email={user.email}>
      <PageHeader
        title="Accounts"
        actions={
          <>
            {/* The empty state below owns the connect CTA when there is
                nothing to show. Rendering both mounts two Plaid Link
                instances on one page, which Plaid explicitly calls
                unsupported. */}
            {accounts.length > 0 && <ConnectBankButton />}
            {plaidAccounts.length > 0 && <RefreshButton />}
          </>
        }
      />

      {visibleHouseholdIds.length > 0 && (
        <nav
          aria-label="Financial scope"
          className="flex flex-wrap gap-2 text-sm font-semibold"
        >
          <Link
            href="/accounts"
            aria-current={!isHouseholdScope(scope) ? "page" : undefined}
            className={`min-h-11 rounded-field border px-4 py-2.5 focus-visible:outline-2 ${
              !isHouseholdScope(scope)
                ? "border-accent/30 bg-accent-soft text-accent"
                : "border-panel-border text-muted hover:bg-panel-hover"
            }`}
          >
            Mine
          </Link>
          <Link
            href={`/accounts?scope=${visibleHouseholdIds[0]}`}
            aria-current={isHouseholdScope(scope) ? "page" : undefined}
            className={`min-h-11 rounded-field border px-4 py-2.5 focus-visible:outline-2 ${
              isHouseholdScope(scope)
                ? "border-accent/30 bg-accent-soft text-accent"
                : "border-panel-border text-muted hover:bg-panel-hover"
            }`}
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
          <NetWorthHero summary={built.summary} historyStartsOn={built.historyStartsOn} />
          <AccountsFilters
            current={filterValues}
            institutions={institutions}
            householdScope={isHouseholdScope(scope)}
            ownerOptions={ownerOptions}
          >
            <AccountPreferences
              accounts={allRows.map((row) => ({ id: row.id, name: row.name }))}
              initialPrefs={prefs}
            />
          </AccountsFilters>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="min-w-0 space-y-4">
              {(Object.keys(view.groups) as AccountGroupKey[]).map((key) => (
                <AccountGroup
                  key={key}
                  groupKey={key}
                  group={view.groups[key]}
                />
              ))}
            </div>
            <div className="lg:sticky lg:top-5">
              <SummaryPanel
                summary={built.summary}
                mode={filterValues.summary ?? "totals"}
                query={filterValues}
                filtered={accountsViewIsFiltered(viewOptions)}
                exportHref={exportHref}
              />
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
