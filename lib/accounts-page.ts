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
  updatedAgo: string;
  stale: boolean;
  spark: number[];
  monthChange: BalanceChange | null;
  includeInNetWorth: boolean;
}

export interface AccountsPageData {
  groups: Record<
    AccountGroupKey,
    {
      label: string;
      totals: CurrencyTotal[];
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

const GROUP_LABELS: Record<AccountGroupKey, string> = {
  credit: "Credit cards",
  cash: "Cash",
  investment: "Investments",
  loan: "Loans",
  other: "Other",
};

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

function displayBalance(
  group: AccountGroupKey,
  balance: number | null,
): number | null {
  if (balance === null) return null;
  return group === "credit" || group === "loan"
    ? Math.abs(balance)
    : balance;
}

export function buildAccountsPageData(
  accounts: UnifiedAccountSummary[],
  snapshots: AccountBalanceSnapshot[],
  now: Date,
): AccountsPageData {
  const groups: AccountsPageData["groups"] = {
    credit: { label: GROUP_LABELS.credit, totals: [], rows: [] },
    cash: { label: GROUP_LABELS.cash, totals: [], rows: [] },
    investment: { label: GROUP_LABELS.investment, totals: [], rows: [] },
    loan: { label: GROUP_LABELS.loan, totals: [], rows: [] },
    other: { label: GROUP_LABELS.other, totals: [], rows: [] },
  };

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
    const history = snapshotsBySource.get(account.id) ?? [];
    const values = history.map((snapshot) =>
      displayBalance(group, snapshot.currentBalance)!,
    );
    const rowSeries = history.map((snapshot, index) => ({
      date: snapshot.snapshotDate,
      value: values[index]!,
    }));
    const freshness = humanizeUpdatedAt(account.updatedAt, now);
    const mask = account.mask ? ` (...${account.mask})` : "";
    groups[group].rows.push({
      id: account.id,
      ownerUserId: account.ownerUserId,
      source: account.source,
      name: `${account.name}${mask}`,
      type: account.type,
      subtype: account.subtype,
      balance: displayBalance(group, account.currentBalance),
      currency: account.currency,
      institution: account.institution,
      updatedAgo: freshness.label,
      stale: freshness.stale,
      spark: values.slice(-30),
      monthChange: changeFromSeries(rowSeries),
      includeInNetWorth: account.includeInNetWorth,
    });
  }

  for (const group of Object.values(groups)) {
    group.rows.sort((a, b) => a.name.localeCompare(b.name));
    const totals = new Map<string, number>();
    for (const row of group.rows) {
      if (row.balance !== null) addAmount(totals, row.currency, row.balance);
    }
    group.totals = totalsFromMap(totals);
  }

  const assets = new Map<string, number>();
  const liabilities = new Map<string, number>();
  for (const account of accounts) {
    if (!account.includeInNetWorth || account.currentBalance === null) continue;
    const group = groupKeyFor(account.type, account.subtype);
    const balance = displayBalance(group, account.currentBalance)!;
    addAmount(
      group === "credit" || group === "loan" ? liabilities : assets,
      account.currency,
      balance,
    );
  }

  const netWorth = new Map<string, number>();
  for (const [currency, amount] of assets) addAmount(netWorth, currency, amount);
  for (const [currency, amount] of liabilities) {
    addAmount(netWorth, currency, -amount);
  }

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const seriesMaps = new Map<string, Map<string, number>>();
  for (const snapshot of snapshots) {
    const id = sourceId(snapshot);
    if (!id || snapshot.currentBalance === null) continue;
    const account = accountById.get(id);
    if (!account?.includeInNetWorth) continue;
    const group = groupKeyFor(account.type, account.subtype);
    const signed =
      group === "credit" || group === "loan"
        ? -Math.abs(snapshot.currentBalance)
        : snapshot.currentBalance;
    const currency = snapshot.currency;
    const byDate = seriesMaps.get(currency) ?? new Map<string, number>();
    addAmount(byDate, snapshot.snapshotDate, signed);
    seriesMaps.set(currency, byDate);
  }

  const netWorthSeries: AccountsPageData["summary"]["netWorthSeries"] = {};
  const netWorthMonthChange: AccountsPageData["summary"]["netWorthMonthChange"] =
    {};
  for (const [currency, byDate] of [...seriesMaps].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const series = [...byDate]
      .map(([date, value]) => ({ date, value: round(value) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    netWorthSeries[currency] = series;
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
  ].sort();
  const historyStartsOn =
    snapshots
      .map((snapshot) => snapshot.snapshotDate)
      .sort()
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
      return [key, { ...group, rows }];
    }),
  ) as AccountsPageData["groups"];

  return { ...data, groups };
}
