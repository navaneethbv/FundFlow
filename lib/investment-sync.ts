import "server-only";
import type { Holding, InvestmentTransaction, Security } from "plaid";
import { getPlaidClient } from "@/lib/plaid";
import { createServiceClient } from "@/lib/supabase/service";
import { decryptItemTokenAndUpgrade, listActiveItems } from "@/lib/plaid-service";
import type { PlaidItemRow } from "@/lib/types";
import { logError } from "@/lib/log";

export type InvestmentSyncOutcome =
  | "synced"
  | "product_not_ready"
  | "no_investment_product"
  | "rate_limited";

export interface InvestmentSyncResult {
  outcome: InvestmentSyncOutcome;
  holdingsSynced: number;
}

/** Outcomes worth a later retry rather than surfacing as a broken connection. */
export const RETRIABLE_INVESTMENT_OUTCOMES: InvestmentSyncOutcome[] = [
  "product_not_ready",
  "rate_limited",
];

const NO_PRODUCT_CODES = new Set([
  "ADDITIONAL_CONSENT_REQUIRED",
  "INVALID_PRODUCT",
  "PRODUCTS_NOT_SUPPORTED",
  "NO_INVESTMENT_ACCOUNTS",
]);
const RATE_LIMIT_CODES = new Set(["RATE_LIMIT_EXCEEDED", "RATE_LIMIT"]);

function plaidErrorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { error_code?: unknown } } })
    ?.response?.data?.error_code;
  return typeof code === "string" ? code : null;
}

function plaidCancellationId(transaction: InvestmentTransaction): string | null {
  const value = Reflect.get(transaction, "cancel_transaction_id");
  return typeof value === "string" ? value : null;
}

function investmentOutcome(
  error: unknown,
): InvestmentSyncOutcome | null {
  const code = plaidErrorCode(error);
  if (code === "PRODUCT_NOT_READY") return "product_not_ready";
  if (code && NO_PRODUCT_CODES.has(code)) return "no_investment_product";
  if (code && RATE_LIMIT_CODES.has(code)) return "rate_limited";
  return null;
}

async function fetchInvestmentHoldings(
  plaid: ReturnType<typeof getPlaidClient>,
  accessToken: string,
): Promise<
  | { holdings: Holding[]; securities: Security[]; plaidAccounts: { account_id: string }[] }
  | { outcome: InvestmentSyncOutcome; holdingsSynced: 0 }
> {
  try {
    const response = await plaid.investmentsHoldingsGet({ access_token: accessToken });
    return {
      holdings: response.data.holdings,
      securities: response.data.securities,
      plaidAccounts: response.data.accounts,
    };
  } catch (error) {
    const outcome = investmentOutcome(error);
    if (outcome) return { outcome, holdingsSynced: 0 };
    throw error;
  }
}

/** Upsert every security in the response, keyed by plaid_security_id; returns plaid id -> db id. */
async function upsertSecurities(
  supabase: ReturnType<typeof createServiceClient>,
  securities: Security[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (securities.length === 0) return map;

  const rows = securities.map((s) => ({
    plaid_security_id: s.security_id,
    ticker: s.ticker_symbol ?? null,
    name: s.name ?? s.ticker_symbol ?? "Unnamed security",
    security_type: s.type ?? null,
    security_subtype: s.subtype ?? null,
    close_price: s.close_price ?? null,
    close_price_as_of: s.close_price_as_of ?? null,
    iso_currency_code: s.iso_currency_code ?? null,
  }));

  const { data, error } = await supabase
    .from("securities")
    .upsert(rows, { onConflict: "plaid_security_id" })
    .select("id, plaid_security_id");
  if (error) throw error;

  for (const row of data ?? []) {
    map.set(row.plaid_security_id as string, row.id as string);
  }
  return map;
}

/**
 * Sync one item's investment holdings. Mark-and-sweep runs only once the full
 * response has been read and upserted without error — a partial or failed
 * response must never deactivate holdings the last good sync established.
 *
 * PRODUCT_NOT_READY, permission-shaped errors (no Investments product on this
 * Item), and rate limiting are reported distinctly rather than as a broken
 * connection: none of them mean the user's data is wrong, only that this run
 * has nothing new to say.
 */
export async function syncInvestmentsForItem(
  item: PlaidItemRow,
): Promise<InvestmentSyncResult> {
  const plaid = getPlaidClient();
  const accessToken = await decryptItemTokenAndUpgrade(item);

  const fetched = await fetchInvestmentHoldings(plaid, accessToken);
  if ("outcome" in fetched) return fetched;
  const { holdings, securities, plaidAccounts } = fetched;

  const supabase = createServiceClient();

  // Scoped to this item's own accounts only — a shared getAccountIdMap keyed
  // just by user would let one item's absent holdings deactivate another
  // item's, since both belong to the same user.
  const { data: itemAccounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id, plaid_account_id")
    .eq("plaid_item_id", item.id)
    .eq("user_id", item.user_id);
  if (accountsError) throw accountsError;
  const accountIdMap = new Map<string, string>(
    (itemAccounts ?? []).map((a) => [a.plaid_account_id as string, a.id as string]),
  );
  const itemAccountDbIds = [...accountIdMap.values()];

  if (plaidAccounts.length === 0 || itemAccountDbIds.length === 0) {
    return { outcome: "no_investment_product", holdingsSynced: 0 };
  }

  const securityIdMap = await upsertSecurities(supabase, securities);

  const rows = holdings
    .map((h) => {
      const accountDbId = accountIdMap.get(h.account_id);
      const securityDbId = securityIdMap.get(h.security_id);
      if (!accountDbId || !securityDbId) return null;
      return {
        user_id: item.user_id,
        account_id: accountDbId,
        security_id: securityDbId,
        quantity: h.quantity ?? null,
        cost_basis: h.cost_basis ?? null,
        institution_price: h.institution_price ?? null,
        institution_value: h.institution_value ?? null,
        as_of: h.institution_price_as_of ?? null,
        source: "plaid" as const,
        is_active: true,
        last_seen_at: new Date().toISOString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  let syncedIds = new Set<string>();
  if (rows.length > 0) {
    const { data: upserted, error } = await supabase
      .from("holdings")
      .upsert(rows, { onConflict: "account_id,security_id,source" })
      .select("id, account_id, security_id");
    if (error) throw error;
    syncedIds = new Set((upserted ?? []).map((r) => r.id as string));

    // Daily price/quantity/value point for balance history and (Phase 9B)
    // time-weighted return. Postgres does not guarantee RETURNING order, so
    // snapshots are paired to holdings by their stable (account_id,
    // security_id) key rather than by array index.
    const idByKey = new Map(
      (upserted ?? []).map((r) => [
        `${r.account_id as string}:${r.security_id as string}`,
        r.id as string,
      ]),
    );
    const today = new Date().toISOString().slice(0, 10);
    const snapshotRows = rows
      .filter((row) => idByKey.has(`${row.account_id}:${row.security_id}`))
      .map((row) => ({
        user_id: item.user_id,
        holding_id: idByKey.get(`${row.account_id}:${row.security_id}`),
        snapshot_date: today,
        quantity: row.quantity,
        price: row.institution_price,
        value: row.institution_value,
      }));
    const { error: snapshotError } = await supabase
      .from("holding_snapshots")
      .upsert(snapshotRows, { onConflict: "holding_id,snapshot_date" });
    if (snapshotError) throw snapshotError;
  }

  // Mark-and-sweep: only after the full response above has landed without
  // error. Any previously-active Plaid holding on this item's accounts that
  // this response did not confirm has been sold or closed.
  const { data: existing, error: existingError } = await supabase
    .from("holdings")
    .select("id")
    .in("account_id", itemAccountDbIds)
    .eq("source", "plaid")
    .eq("is_active", true);
  if (existingError) throw existingError;
  const staleIds = (existing ?? [])
    .map((r) => r.id as string)
    .filter((id) => !syncedIds.has(id));
  if (staleIds.length > 0) {
    const { error: deactivateError } = await supabase
      .from("holdings")
      .update({ is_active: false })
      .in("id", staleIds);
    if (deactivateError) throw deactivateError;
  }

  return { outcome: "synced", holdingsSynced: rows.length };
}

/** Same lookback window used when a Link is first created (see link-token/route.ts). */
const INVESTMENT_TRANSACTION_LOOKBACK_DAYS = 730;

async function fetchInvestmentTransactions(
  plaid: ReturnType<typeof getPlaidClient>,
  accessToken: string,
  startDate: string,
  today: string,
): Promise<
  | { transactions: InvestmentTransaction[] }
  | { outcome: InvestmentSyncOutcome; transactionsSynced: 0 }
> {
  const all: InvestmentTransaction[] = [];
  try {
    let offset = 0;
    let total = Infinity;
    while (all.length < total) {
      const response = await plaid.investmentsTransactionsGet({
        access_token: accessToken,
        start_date: startDate,
        end_date: today,
        options: { offset, count: 500 },
      });
      const page = response.data.investment_transactions;
      all.push(...page);
      total = response.data.total_investment_transactions;
      offset = all.length;
      if (page.length === 0) break;
    }
  } catch (error) {
    const outcome = investmentOutcome(error);
    if (outcome) return { outcome, transactionsSynced: 0 };
    throw error;
  }
  return { transactions: all };
}

function daysBefore(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export interface InvestmentTransactionSyncResult {
  outcome: InvestmentSyncOutcome;
  transactionsSynced: number;
}

/**
 * Sync investment transactions for one item over an explicit, bounded date
 * range — this endpoint has no cursor, so every run re-requests the same
 * window and relies on the unique `plaid_investment_transaction_id` for
 * idempotency rather than a persisted position.
 */
export async function syncInvestmentTransactionsForItem(
  item: PlaidItemRow,
  today: string,
): Promise<InvestmentTransactionSyncResult> {
  const plaid = getPlaidClient();
  const accessToken = await decryptItemTokenAndUpgrade(item);
  const startDate = daysBefore(today, INVESTMENT_TRANSACTION_LOOKBACK_DAYS);

  const fetched = await fetchInvestmentTransactions(
    plaid,
    accessToken,
    startDate,
    today,
  );
  if ("outcome" in fetched) return fetched;
  const { transactions: all } = fetched;

  if (all.length === 0) return { outcome: "synced", transactionsSynced: 0 };

  const supabase = createServiceClient();
  const { data: itemAccounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id, plaid_account_id")
    .eq("plaid_item_id", item.id)
    .eq("user_id", item.user_id);
  if (accountsError) throw accountsError;
  const accountIdMap = new Map<string, string>(
    (itemAccounts ?? []).map((a) => [a.plaid_account_id as string, a.id as string]),
  );

  const securityPlaidIds = [...new Set(all.map((t) => t.security_id).filter((id): id is string => !!id))];
  const { data: securityRows, error: securityError } = await supabase
    .from("securities")
    .select("id, plaid_security_id")
    .in("plaid_security_id", securityPlaidIds.length > 0 ? securityPlaidIds : [""]);
  if (securityError) throw securityError;
  const securityIdMap = new Map<string, string>(
    (securityRows ?? []).map((s) => [s.plaid_security_id as string, s.id as string]),
  );

  const rows = all
    .map((t) => {
      const accountDbId = accountIdMap.get(t.account_id);
      if (!accountDbId) return null;
      return {
        user_id: item.user_id,
        account_id: accountDbId,
        security_id: t.security_id ? (securityIdMap.get(t.security_id) ?? null) : null,
        plaid_investment_transaction_id: t.investment_transaction_id,
        date: t.date,
        name: t.name ?? null,
        amount: t.amount,
        quantity: t.quantity ?? null,
        price: t.price ?? null,
        fees: t.fees ?? null,
        txn_type: t.type ?? null,
        txn_subtype: t.subtype ?? null,
        iso_currency_code: t.iso_currency_code ?? null,
        // Plaid still returns this legacy field for some institutions, but the
        // current SDK marks direct property access deprecated. Keep the
        // compatibility read isolated until Plaid removes the field entirely.
        cancel_plaid_id: plaidCancellationId(t),
        is_active: true,
        last_seen_at: new Date().toISOString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length > 0) {
    const { error } = await supabase
      .from("investment_transactions")
      .upsert(rows, { onConflict: "plaid_investment_transaction_id" });
    if (error) throw error;
  }

  // A cancellation transaction arrives as its own row; deactivate the row it
  // cancels rather than deleting it, so the reversed original stays in the
  // audit trail instead of vanishing from history.
  const cancelIds = rows.map((r) => r.cancel_plaid_id).filter((id): id is string => !!id);
  if (cancelIds.length > 0) {
    const { error: cancelError } = await supabase
      .from("investment_transactions")
      .update({ is_active: false })
      .in("plaid_investment_transaction_id", cancelIds);
    if (cancelError) throw cancelError;
  }

  return { outcome: "synced", transactionsSynced: rows.length };
}

async function recordInvestmentJob(
  userId: string,
  itemDbId: string,
  status: "done" | "failed",
  lastError: string | null,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("sync_jobs").insert({
      user_id: userId,
      plaid_item_id: itemDbId,
      job_type: "investments",
      status,
      attempts: 1,
      last_error: lastError,
    });
    if (error) throw error;
  } catch (error) {
    logError("investment-sync.job-record", error);
  }
}

/**
 * Sync investment holdings for every active item a user has. Failures are
 * isolated per item (one broken connection must not stop the rest) and, at
 * the caller, isolated from transaction sync entirely — a user with no
 * investment accounts anywhere must never see their bank sync degrade.
 */
export async function syncInvestmentsForUser(
  userId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<number> {
  const items = await listActiveItems(userId);
  let totalSynced = 0;

  for (const item of items) {
    try {
      const result = await syncInvestmentsForItem(item);
      totalSynced += result.holdingsSynced;
      if (result.outcome === "synced") {
        await recordInvestmentJob(userId, item.id, "done", null);
      } else {
        // Not a failure — recorded so retriable outcomes are visible in the
        // same observability trail, without touching plaid_items.status.
        await recordInvestmentJob(userId, item.id, "done", result.outcome);
      }
    } catch (error) {
      logError("investment-sync.item", error);
      const code = plaidErrorCode(error) ?? "sync_failed";
      await recordInvestmentJob(userId, item.id, "failed", code);
    }

    // Isolated from the holdings sync above: a broken investment-transactions
    // pull must not be conflated with, or block, the holdings snapshot that
    // just succeeded (or failed) for the same item.
    try {
      await syncInvestmentTransactionsForItem(item, today);
    } catch (error) {
      logError("investment-sync.transactions", error);
    }
  }

  return totalSynced;
}
