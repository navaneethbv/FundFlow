/**
 * Phase 9A: pure aggregation over already-fetched holdings and snapshots.
 * No Supabase or Plaid imports here — see lib/investment-sync.ts for the I/O
 * side. Keeping this pure is what makes buildInvestmentsPage exhaustively
 * unit-testable without a database.
 */

export interface HoldingJoinRow {
  id: string; // holdings.id
  accountId: string | null;
  manualAccountId: string | null;
  accountName: string;
  securityName: string;
  ticker: string | null;
  securityType: string | null; // null => grouped under "Unclassified"
  quantity: number | null;
  price: number | null; // institution_price ?? securities.close_price
  value: number | null; // institution_value
  source: "plaid" | "manual";
  isActive: boolean;
}

export interface HoldingSnapshotRow {
  holdingId: string;
  snapshotDate: string; // YYYY-MM-DD
  quantity: number | null;
  price: number | null;
  value: number | null;
}

export interface HoldingRow extends HoldingJoinRow {
  weightPct: number; // value / portfolio total, 0 when total is 0
  periodChangePct: number | null; // price change over the available history, null without it
}

export interface InvestmentsPage {
  total: number;
  dayChange: { amount: number; pct: number } | null; // vs the prior snapshot day
  byClass: { label: string; holdings: HoldingRow[]; subtotal: number }[];
  topMovers: {
    id: string;
    name: string;
    ticker: string | null;
    changePct: number;
  }[] | null;
  balanceHistory: { date: string; value: number }[];
}

/**
 * Fixed slot order so the allocation view never reorders classes as holdings
 * come and go — the same invariant the chart palette applies to categories.
 * "Other" and "Unclassified" always sort last.
 */
const ASSET_CLASS_ORDER = [
  "Stocks",
  "Funds",
  "Bonds",
  "Cash",
  "Crypto",
  "Other",
  "Unclassified",
] as const;

const SECURITY_TYPE_TO_CLASS: Record<string, (typeof ASSET_CLASS_ORDER)[number]> = {
  equity: "Stocks",
  etf: "Funds",
  "mutual fund": "Funds",
  "fixed income": "Bonds",
  cash: "Cash",
  cryptocurrency: "Crypto",
  derivative: "Other",
  loan: "Other",
  other: "Other",
};

export interface ManualHoldingInput {
  accountSource: "plaid" | "manual";
  accountId: string;
  securityName: string;
  ticker: string | null;
  securityType: string | null;
  quantity: number;
  price: number;
  asOf: string; // YYYY-MM-DD
  currency: string;
}

export type ManualHoldingResult =
  | { ok: true; value: ManualHoldingInput }
  | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_SECURITY_TYPES = new Set([
  "equity",
  "etf",
  "mutual fund",
  "fixed income",
  "cash",
  "cryptocurrency",
  "derivative",
  "loan",
  "other",
]);

/**
 * Validates a manually-entered holding. A manual value must never claim
 * market freshness it doesn't have, so quantity, price, and as-of date are
 * all required — there is no "leave it blank and we'll estimate" path.
 */
export function normalizeManualHolding(
  body: unknown,
  today: string,
): ManualHoldingResult {
  const b = (body ?? {}) as Record<string, unknown>;

  const accountSource = b.accountSource;
  if (accountSource !== "plaid" && accountSource !== "manual") {
    return { ok: false, error: "accountSource must be 'plaid' or 'manual'" };
  }
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  if (!accountId) return { ok: false, error: "accountId is required" };

  const securityName = typeof b.securityName === "string" ? b.securityName.trim() : "";
  if (!securityName || securityName.length > 160) {
    return { ok: false, error: "securityName must be between 1 and 160 characters" };
  }

  const ticker =
    typeof b.ticker === "string" && b.ticker.trim().length > 0
      ? b.ticker.trim().slice(0, 16)
      : null;

  const securityType =
    typeof b.securityType === "string" && KNOWN_SECURITY_TYPES.has(b.securityType)
      ? b.securityType
      : null;

  const quantity = b.quantity;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: "quantity must be a positive number" };
  }

  const price = b.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    return { ok: false, error: "price must be a non-negative number" };
  }

  const asOf = b.asOf;
  if (typeof asOf !== "string" || !DATE_RE.test(asOf)) {
    return { ok: false, error: "asOf must be a YYYY-MM-DD date" };
  }
  if (asOf > today) {
    return { ok: false, error: "asOf cannot be in the future" };
  }

  const currency =
    typeof b.currency === "string" && /^[A-Z]{3}$/.test(b.currency) ? b.currency : "USD";

  return {
    ok: true,
    value: { accountSource, accountId, securityName, ticker, securityType, quantity, price, asOf, currency },
  };
}

export interface InvestmentTransactionRow {
  date: string;
  amount: number; // Plaid sign: positive = debited from the account
  txnSubtype: string | null;
}

/**
 * Money entering or leaving the account from outside it — never a buy or
 * sell, which only move value between cash and holdings inside the account.
 * See lib/investment-performance.ts for why this distinction is what makes
 * time-weighted return possible.
 */
const EXTERNAL_FLOW_SUBTYPES = new Set(["deposit", "withdrawal", "contribution", "distribution"]);

/**
 * Maps Plaid's sign (positive = debited/outflow) onto the performance
 * module's convention (positive = added to the portfolio) by negating it.
 */
export function externalFlowsFromTransactions(
  rows: InvestmentTransactionRow[],
): { date: string; amount: number }[] {
  return rows
    .filter((r) => r.txnSubtype != null && EXTERNAL_FLOW_SUBTYPES.has(r.txnSubtype))
    .map((r) => ({ date: r.date, amount: -r.amount }));
}

export function classifySecurityType(securityType: string | null): string {
  if (!securityType) return "Unclassified";
  return SECURITY_TYPE_TO_CLASS[securityType.toLowerCase()] ?? "Other";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function effectiveValue(h: HoldingJoinRow): number {
  if (h.value != null) return h.value;
  if (h.quantity != null && h.price != null) return round2(h.quantity * h.price);
  return 0;
}

/** First vs last snapshot by date for one holding; null without at least two points. */
function periodChangePctFor(
  holdingId: string,
  snapshots: HoldingSnapshotRow[],
): number | null {
  const rows = snapshots
    .filter((s) => s.holdingId === holdingId && s.price != null)
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  if (rows.length < 2) return null;
  const first = rows[0].price as number;
  const last = rows[rows.length - 1].price as number;
  if (first === 0) return null;
  return round2(((last - first) / first) * 100);
}

/** Portfolio total by distinct snapshot date, across every holding present that day. */
function totalsByDate(snapshots: HoldingSnapshotRow[]): { date: string; value: number }[] {
  const byDate = new Map<string, number>();
  for (const s of snapshots) {
    if (s.value == null) continue;
    byDate.set(s.snapshotDate, (byDate.get(s.snapshotDate) ?? 0) + s.value);
  }
  return [...byDate.entries()]
    .map(([date, value]) => ({ date, value: round2(value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildInvestmentsPage(
  holdings: HoldingJoinRow[],
  snapshots: HoldingSnapshotRow[],
): InvestmentsPage {
  const active = holdings.filter((h) => h.isActive);
  const total = round2(active.reduce((sum, h) => sum + effectiveValue(h), 0));

  const rows: HoldingRow[] = active.map((h) => ({
    ...h,
    weightPct: total === 0 ? 0 : round2((effectiveValue(h) / total) * 100),
    periodChangePct: periodChangePctFor(h.id, snapshots),
  }));

  const byClassMap = new Map<string, HoldingRow[]>();
  for (const row of rows) {
    const label = classifySecurityType(row.securityType);
    const list = byClassMap.get(label) ?? [];
    list.push(row);
    byClassMap.set(label, list);
  }

  const byClass = ASSET_CLASS_ORDER.filter((label) => byClassMap.has(label)).map((label) => {
    const classHoldings = [...(byClassMap.get(label) ?? [])].sort(
      (a, b) => effectiveValue(b) - effectiveValue(a),
    );
    return {
      label,
      holdings: classHoldings,
      subtotal: round2(classHoldings.reduce((sum, h) => sum + effectiveValue(h), 0)),
    };
  });

  const movers = rows
    .filter((r) => r.periodChangePct != null)
    .sort((a, b) => Math.abs(b.periodChangePct as number) - Math.abs(a.periodChangePct as number))
    .slice(0, 5)
    .map((r) => ({
      // The holding id is the stable key: the same security (name+ticker) can
      // exist in several accounts, so name/ticker alone would collide.
      id: r.id,
      name: r.securityName,
      ticker: r.ticker,
      changePct: r.periodChangePct as number,
    }));

  const dates = totalsByDate(snapshots);
  let dayChange: InvestmentsPage["dayChange"] = null;
  if (dates.length >= 2) {
    const latest = dates[dates.length - 1];
    const prev = dates[dates.length - 2];
    if (prev.value !== 0) {
      dayChange = {
        amount: round2(latest.value - prev.value),
        pct: round2(((latest.value - prev.value) / prev.value) * 100),
      };
    }
  }

  return {
    total,
    dayChange,
    byClass,
    topMovers: movers.length > 0 ? movers : null,
    balanceHistory: dates,
  };
}
