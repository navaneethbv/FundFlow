import {
  classifyBalanceSheetAmount,
  netWorthContribution,
} from "@/lib/account-balance";
import { normalizeExternalDisplayText } from "@/lib/external-display-text";

export type AccountGroupKey =
  | "credit"
  | "cash"
  | "investment"
  | "loan"
  | "other";

export interface UnifiedAccountSummary {
  id: string;
  ownerUserId: string;
  source: "plaid" | "manual";
  name: string;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  currency: string;
  institution: string | null;
  institutionLogo: string | null;
  institutionBrandColor: string | null;
  updatedAt: string;
  includeInNetWorth: boolean;
}

export interface AccountBalanceSnapshot {
  accountId: string | null;
  manualAccountId: string | null;
  snapshotDate: string;
  currentBalance: number | null;
  availableBalance: number | null;
  currency: string;
}

export interface CurrencyTotal {
  currency: string;
  amount: number;
}

export interface GroupAmount {
  group: AccountGroupKey;
  label: string;
  amount: number;
}

export interface BalanceChange {
  amount: number;
  pct: number | null;
}

export interface AccountsPageRow {
  id: string;
  ownerUserId: string;
  source: "plaid" | "manual";
  name: string;
  type: string | null;
  subtype: string | null;
  balance: number | null;
  currency: string;
  institution: string | null;
  institutionLogo: string | null;
  institutionBrandColor: string | null;
  updatedAgo: string;
  stale: boolean;
  spark: number[];
  /**
   * The full available snapshot history (unsliced), for a second, longer-
   * window trend column next to `spark`'s last-30-days one — Monarch shows
   * both side by side per row, and this is the same per-account series
   * `spark` is already sliced from, just not truncated.
   */
  sparkLong: number[];
  monthChange: BalanceChange | null;
  includeInNetWorth: boolean;
}

export interface AccountsPageData {
  groups: Record<
    AccountGroupKey,
    {
      label: string;
      totals: CurrencyTotal[];
      /**
       * Sum of each row's own `monthChange.amount`, bucketed by currency —
       * the group header's change annotation next to its total pill. A row
       * with no `monthChange` (not enough history) simply contributes zero,
       * so a brand-new account never blocks the rest of the group from
       * reporting a change.
       */
      changes: CurrencyTotal[];
      rows: AccountsPageRow[];
    }
  >;
  summary: {
    currencies: string[];
    currencyMismatch: boolean;
    assets: CurrencyTotal[];
    liabilities: CurrencyTotal[];
    netWorth: CurrencyTotal[];
    netWorthSeries: Record<string, Array<{ date: string; value: number }>>;
    netWorthMonthChange: Record<string, BalanceChange | null>;
    /**
     * Assets/liabilities broken down by account group, keyed by currency —
     * the right-rail Summary card's stacked bar + legend. Sorted by amount
     * descending so the bar's largest segment always draws first. Same
     * `includeInNetWorth` filter as `assets`/`liabilities`, so the two stay
     * reconcilable (each currency's group amounts sum to its plain total).
     */
    assetsByGroup: Record<string, GroupAmount[]>;
    liabilitiesByGroup: Record<string, GroupAmount[]>;
  };
  historyStartsOn: string | null;
}

export interface AccountsPageViewOptions {
  hiddenIds?: string[];
  order?: string[];
  visibility?: "visible" | "hidden" | "all";
  institution?: string;
  groupKey?: AccountGroupKey;
  ownerUserId?: string;
}

/**
 * True when the view options actually remove rows the unfiltered page shows.
 * The page uses this to disclose that the balance-sheet summary still covers
 * every account, since that summary is deliberately portfolio-wide.
 */
export function accountsViewIsFiltered(
  options: AccountsPageViewOptions,
): boolean {
  return Boolean(
    options.institution ||
      options.groupKey ||
      options.ownerUserId ||
      (options.visibility ?? "visible") !== "all" ||
      (options.hiddenIds?.length ?? 0) > 0,
  );
}

const GROUP_LABELS: Record<AccountGroupKey, string> = {
  credit: "Credit cards",
  cash: "Cash",
  investment: "Investments",
  loan: "Loans",
  other: "Other",
};

export function compareTextAscending(a: string, b: string): number {
  return a.localeCompare(b);
}

export function groupKeyFor(
  type: string | null,
  subtype: string | null,
): AccountGroupKey {
  const normalizedType = type?.toLowerCase() ?? "";
  const normalizedSubtype = subtype?.toLowerCase() ?? "";
  if (
    normalizedType === "credit" ||
    normalizedSubtype.includes("credit card")
  ) {
    return "credit";
  }
  if (
    normalizedType === "depository" ||
    normalizedType === "cash" ||
    ["checking", "savings", "money market"].includes(normalizedSubtype)
  ) {
    return "cash";
  }
  if (
    normalizedType === "investment" ||
    normalizedSubtype.includes("brokerage")
  ) {
    return "investment";
  }
  if (
    normalizedType === "loan" ||
    normalizedType === "debt" ||
    normalizedType === "liability"
  ) {
    return "loan";
  }
  return "other";
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function change(start: number, end: number): BalanceChange {
  return {
    amount: round(end - start),
    pct: start === 0 ? null : round(((end - start) / Math.abs(start)) * 100),
  };
}

function thresholdDate(latestDate: string): string {
  const latest = new Date(`${latestDate}T00:00:00.000Z`);
  latest.setUTCDate(latest.getUTCDate() - 30);
  return latest.toISOString().slice(0, 10);
}

function changeFromSeries(
  series: Array<{ date: string; value: number }>,
): BalanceChange | null {
  if (series.length < 2) return null;
  const latest = series.at(-1)!;
  const threshold = thresholdDate(latest.date);
  const first = series.find((point) => point.date >= threshold);
  if (!first || first === latest) return null;
  return change(first.value, latest.value);
}

function humanizeUpdatedAt(
  value: string,
  now: Date,
): { label: string; stale: boolean } {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return { label: "unknown", stale: true };
  const elapsedMs = Math.max(0, now.getTime() - timestamp);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return { label: "just now", stale: false };
  if (minutes < 60) {
    return {
      label: `${minutes} minute${minutes === 1 ? "" : "s"} ago`,
      stale: false,
    };
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return {
      label: `${hours} hour${hours === 1 ? "" : "s"} ago`,
      stale: false,
    };
  }
  const days = Math.floor(hours / 24);
  return {
    label: `${days} day${days === 1 ? "" : "s"} ago`,
    stale: true,
  };
}

function sourceId(snapshot: AccountBalanceSnapshot): string | null {
  return snapshot.accountId ?? snapshot.manualAccountId;
}

function totalsFromMap(map: Map<string, number>): CurrencyTotal[] {
  return [...map]
    .map(([currency, amount]) => ({ currency, amount: round(amount) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function addAmount(map: Map<string, number>, currency: string, amount: number) {
  map.set(currency, (map.get(currency) ?? 0) + amount);
}

function displayBalance(balance: number | null): number | null {
  return balance;
}

function createAccountGroups(): AccountsPageData["groups"] {
  const create = (key: AccountGroupKey) => ({
    label: GROUP_LABELS[key],
    totals: [] as CurrencyTotal[],
    changes: [] as CurrencyTotal[],
    rows: [] as AccountsPageRow[],
  });
  return {
    credit: create("credit"),
    cash: create("cash"),
    investment: create("investment"),
    loan: create("loan"),
    other: create("other"),
  };
}

function buildAccountRow(
  account: UnifiedAccountSummary,
  group: AccountGroupKey,
  history: AccountBalanceSnapshot[],
  now: Date,
): AccountsPageRow {
  const values = history.map(
    (snapshot) => displayBalance(snapshot.currentBalance) ?? 0,
  );
  const rowSeries = history.map((snapshot, index) => ({
    date: snapshot.snapshotDate,
    value: values[index]!,
  }));
  const freshness = humanizeUpdatedAt(account.updatedAt, now);
  const mask = account.mask ? ` (...${account.mask})` : "";
  const cleanName = normalizeExternalDisplayText(account.name) ?? account.name;
  return {
    id: account.id,
    ownerUserId: account.ownerUserId,
    source: account.source,
    name: `${cleanName}${mask}`,
    type: account.type,
    subtype: account.subtype,
    balance: displayBalance(account.currentBalance),
    currency: account.currency,
    institution: account.institution,
    institutionLogo: account.institutionLogo,
    institutionBrandColor: account.institutionBrandColor,
    updatedAgo: freshness.label,
    stale: freshness.stale,
    spark: values.slice(-30),
    sparkLong: values,
    monthChange: changeFromSeries(rowSeries),
    includeInNetWorth: account.includeInNetWorth,
  };
}

function populateGroupTotals(groups: AccountsPageData["groups"]): void {
  for (const [groupKey, group] of Object.entries(groups) as [
    AccountGroupKey,
    AccountsPageData["groups"][AccountGroupKey],
  ][]) {
    group.rows.sort((a, b) => a.name.localeCompare(b.name));
    const totals = new Map<string, number>();
    const changes = new Map<string, number>();
    const changeSign = groupKey === "credit" || groupKey === "loan" ? -1 : 1;
    for (const row of group.rows) {
      if (row.balance !== null) addAmount(totals, row.currency, row.balance);
      if (row.monthChange)
        addAmount(changes, row.currency, row.monthChange.amount * changeSign);
    }
    group.totals = totalsFromMap(totals);
    group.changes = totalsFromMap(changes);
  }
}

function groupAmountsFromMap(
  byGroupMap: Map<string, Map<AccountGroupKey, number>>,
): Record<string, GroupAmount[]> {
  const result: Record<string, GroupAmount[]> = {};
  for (const [currency, byGroup] of byGroupMap) {
    result[currency] = [...byGroup]
      .map(([group, amount]) => ({ group, label: GROUP_LABELS[group], amount: round(amount) }))
      .sort((a, b) => b.amount - a.amount);
  }
  return result;
}

function buildNetWorthTotals(accounts: UnifiedAccountSummary[]): {
  assets: Map<string, number>;
  liabilities: Map<string, number>;
  assetsByGroup: Map<string, Map<AccountGroupKey, number>>;
  liabilitiesByGroup: Map<string, Map<AccountGroupKey, number>>;
} {
  const assets = new Map<string, number>();
  const liabilities = new Map<string, number>();
  const assetsByGroup = new Map<string, Map<AccountGroupKey, number>>();
  const liabilitiesByGroup = new Map<string, Map<AccountGroupKey, number>>();
  for (const account of accounts) {
    if (!account.includeInNetWorth || account.currentBalance === null) continue;
    const group = groupKeyFor(account.type, account.subtype);
    const classification = classifyBalanceSheetAmount(
      account.currentBalance,
      account.type,
      account.subtype,
    );
    const isLiability = classification.kind === "liability";
    addAmount(isLiability ? liabilities : assets, account.currency, classification.amount);
    const byGroupMap = isLiability ? liabilitiesByGroup : assetsByGroup;
    const byGroup = byGroupMap.get(account.currency) ?? new Map<AccountGroupKey, number>();
    byGroup.set(group, (byGroup.get(group) ?? 0) + classification.amount);
    byGroupMap.set(account.currency, byGroup);
  }
  return { assets, liabilities, assetsByGroup, liabilitiesByGroup };
}

function buildNetWorthSeries(
  accounts: UnifiedAccountSummary[],
  snapshots: AccountBalanceSnapshot[],
): AccountsPageData["summary"]["netWorthSeries"] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const seriesMaps = new Map<string, Map<string, number>>();
  for (const snapshot of snapshots) {
    const id = sourceId(snapshot);
    if (!id || snapshot.currentBalance === null) continue;
    const account = accountById.get(id);
    if (!account?.includeInNetWorth) continue;
    const signed = netWorthContribution(
      snapshot.currentBalance,
      account.type,
      account.subtype,
    );
    const byDate = seriesMaps.get(account.currency) ?? new Map<string, number>();
    addAmount(byDate, snapshot.snapshotDate, signed);
    seriesMaps.set(account.currency, byDate);
  }
  return Object.fromEntries([...seriesMaps]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, byDate]) => {
      const series = [...byDate]
        .map(([date, value]) => ({ date, value: round(value) }))
        .sort((a, b) => a.date.localeCompare(b.date));
      return [currency, series];
    })) as AccountsPageData["summary"]["netWorthSeries"];
}

export function buildAccountsPageData(
  accounts: UnifiedAccountSummary[],
  snapshots: AccountBalanceSnapshot[],
  now: Date,
): AccountsPageData {
  const groups = createAccountGroups();

  const snapshotsBySource = new Map<string, AccountBalanceSnapshot[]>();
  for (const snapshot of snapshots) {
    const id = sourceId(snapshot);
    if (!id || snapshot.currentBalance === null) continue;
    const current = snapshotsBySource.get(id) ?? [];
    current.push(snapshot);
    snapshotsBySource.set(id, current);
  }
  for (const history of snapshotsBySource.values()) {
    history.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  }

  for (const account of accounts) {
    const group = groupKeyFor(account.type, account.subtype);
    groups[group].rows.push(buildAccountRow(
      account,
      group,
      snapshotsBySource.get(account.id) ?? [],
      now,
    ));
  }
  populateGroupTotals(groups);

  const { assets, liabilities, assetsByGroup, liabilitiesByGroup } = buildNetWorthTotals(accounts);

  const netWorth = new Map<string, number>();
  for (const [currency, amount] of assets) addAmount(netWorth, currency, amount);
  for (const [currency, amount] of liabilities) {
    addAmount(netWorth, currency, -amount);
  }

  const netWorthSeries = buildNetWorthSeries(accounts, snapshots);
  const netWorthMonthChange: AccountsPageData["summary"]["netWorthMonthChange"] =
    {};
  for (const [currency, series] of Object.entries(netWorthSeries)) {
    netWorthMonthChange[currency] = changeFromSeries(series);
  }

  const currencies = [
    ...new Set(
      accounts
        .filter(
          (account) =>
            account.includeInNetWorth && account.currentBalance !== null,
        )
        .map((account) => account.currency),
    ),
  ].sort(compareTextAscending);
  const historyStartsOn =
    snapshots
      .map((snapshot) => snapshot.snapshotDate)
      .sort(compareTextAscending)
      .at(0) ?? null;

  return {
    groups,
    summary: {
      currencies,
      currencyMismatch: currencies.length > 1,
      assets: totalsFromMap(assets),
      liabilities: totalsFromMap(liabilities),
      netWorth: totalsFromMap(netWorth),
      netWorthSeries,
      netWorthMonthChange,
      assetsByGroup: groupAmountsFromMap(assetsByGroup),
      liabilitiesByGroup: groupAmountsFromMap(liabilitiesByGroup),
    },
    historyStartsOn,
  };
}

export function applyAccountsPageView(
  data: AccountsPageData,
  options: AccountsPageViewOptions,
): AccountsPageData {
  const hidden = new Set(options.hiddenIds ?? []);
  const order = new Map(
    (options.order ?? []).map((accountId, index) => [accountId, index]),
  );
  const visibility = options.visibility ?? "visible";
  const groups = Object.fromEntries(
    (Object.entries(data.groups) as Array<
      [AccountGroupKey, AccountsPageData["groups"][AccountGroupKey]]
    >).map(([key, group]) => {
      const rows =
        options.groupKey && options.groupKey !== key
          ? []
          : group.rows
              .filter((row) => {
                const isHidden = hidden.has(row.id);
                if (visibility === "visible" && isHidden) return false;
                if (visibility === "hidden" && !isHidden) return false;
                if (
                  options.institution &&
                  row.institution !== options.institution
                ) {
                  return false;
                }
                if (
                  options.ownerUserId &&
                  row.ownerUserId !== options.ownerUserId
                ) {
                  return false;
                }
                return true;
              })
              .sort((a, b) => {
                const aOrder = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
                const bOrder = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
                return aOrder - bOrder || a.name.localeCompare(b.name);
              });
      // Totals must be recomputed from the rows that survive filtering — a
      // group header that sums accounts the user cannot see reads as a bug.
      const totals = new Map<string, number>();
      for (const row of rows) {
        if (row.balance !== null) addAmount(totals, row.currency, row.balance);
      }
      return [key, { ...group, rows, totals: totalsFromMap(totals) }];
    }),
  ) as AccountsPageData["groups"];

  return { ...data, groups };
}
