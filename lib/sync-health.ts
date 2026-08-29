import type { SupabaseClient } from "@supabase/supabase-js";
import { isLiabilityAccount } from "@/lib/account-balance";

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const PAGE_SIZE = 1_000;
const MAX_TRANSACTION_PAGES = 20;

export type ProductSyncState =
  | "healthy"
  | "stale"
  | "repair_required"
  | "product_unavailable"
  | "rate_limited"
  | "never_synced";

export interface ProductSyncHealth {
  state: ProductSyncState;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  safeErrorCode: string | null;
}

export interface InstitutionSyncHealth {
  plaidItemId: string;
  institutionName: string;
  transactions: ProductSyncHealth;
  investments: ProductSyncHealth;
  accountsUpdatedAt: string | null;
  oldestTransactionDate: string | null;
  newestTransactionDate: string | null;
}

export type ReconciliationState =
  | "balanced"
  | "difference"
  | "missing_anchor"
  | "missing_balance"
  | "incomplete_history";

export interface AccountReconciliation {
  accountId: string;
  plaidItemId: string;
  accountName: string;
  mask: string | null;
  providerBalance: number | null;
  ledgerBalance: number | null;
  difference: number | null;
  anchorDate: string | null;
  oldestTransactionDate: string | null;
  newestTransactionDate: string | null;
  accountsUpdatedAt: string | null;
  state: ReconciliationState;
}

interface SyncJobRow {
  status: "pending" | "running" | "done" | "failed";
  updated_at: string;
  last_error: string | null;
}

interface SafeItemRow {
  id: string;
  institution_name: string | null;
  status: string;
  error_code: string | null;
}

interface AccountRow {
  id: string;
  plaid_item_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | string | null;
  updated_at: string | null;
}

interface ReconciliationAccount {
  id: string;
  plaidItemId: string;
  name: string;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  currentBalance: number | null;
  updatedAt: string | null;
}

interface SnapshotAnchor {
  snapshotDate: string;
  currentBalance: number;
}

interface ReconciliationTransaction {
  date: string;
  amount: number;
}

const SAFE_ERROR_CODES = new Set([
  "ADDITIONAL_CONSENT_REQUIRED",
  "INSTITUTION_DOWN",
  "INSTITUTION_NOT_RESPONDING",
  "INVALID_PRODUCT",
  "ITEM_LOGIN_REQUIRED",
  "NO_INVESTMENT_ACCOUNTS",
  "PENDING_EXPIRATION",
  "PRODUCT_NOT_READY",
  "PRODUCTS_NOT_SUPPORTED",
  "RATE_LIMIT",
  "RATE_LIMIT_EXCEEDED",
  "TOKEN_ROTATION_LOST",
  "no_investment_product",
  "product_not_ready",
  "rate_limited",
]);

const PRODUCT_UNAVAILABLE_CODES = new Set([
  "INVALID_PRODUCT",
  "NO_INVESTMENT_ACCOUNTS",
  "PRODUCTS_NOT_SUPPORTED",
  "no_investment_product",
]);

const RATE_LIMIT_CODES = new Set(["RATE_LIMIT", "RATE_LIMIT_EXCEEDED", "rate_limited"]);

function safeErrorCode(value: string | null): string | null {
  return value && SAFE_ERROR_CODES.has(value) ? value : null;
}

function validTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function deriveProductSyncHealth(input: Readonly<{
  itemStatus: string;
  itemErrorCode: string | null;
  latestJob: SyncJobRow | null;
  latestSuccessfulJob: SyncJobRow | null;
  now: Date;
}>): ProductSyncHealth {
  const itemCode = safeErrorCode(input.itemErrorCode);
  const jobCode = safeErrorCode(input.latestJob?.last_error ?? null);
  const code = jobCode ?? itemCode;
  const lastSuccessAt = input.latestSuccessfulJob?.updated_at ?? null;
  const lastAttemptAt = input.latestJob?.updated_at ?? null;

  let state: ProductSyncState;
  if (input.itemStatus !== "active") {
    state = "repair_required";
  } else if (code && RATE_LIMIT_CODES.has(code)) {
    state = "rate_limited";
  } else if (code && PRODUCT_UNAVAILABLE_CODES.has(code)) {
    state = "product_unavailable";
  } else if (input.latestJob?.status === "failed" || code) {
    state = "repair_required";
  } else if (!lastSuccessAt) {
    state = "never_synced";
  } else {
    const successTimestamp = validTimestamp(lastSuccessAt);
    state =
      successTimestamp !== null && input.now.getTime() - successTimestamp <= STALE_AFTER_MS
        ? "healthy"
        : "stale";
  }

  return { state, lastSuccessAt, lastAttemptAt, safeErrorCode: code };
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildAccountReconciliation(input: Readonly<{
  account: ReconciliationAccount;
  anchor: SnapshotAnchor | null;
  transactions: ReconciliationTransaction[];
  historyComplete: boolean;
}>): AccountReconciliation {
  const base = {
    accountId: input.account.id,
    plaidItemId: input.account.plaidItemId,
    accountName: input.account.name,
    mask: input.account.mask,
    providerBalance: input.account.currentBalance,
    anchorDate: input.anchor?.snapshotDate ?? null,
    oldestTransactionDate: null,
    newestTransactionDate: null,
    accountsUpdatedAt: input.account.updatedAt,
  };
  if (input.account.currentBalance === null) {
    return { ...base, ledgerBalance: null, difference: null, state: "missing_balance" };
  }
  if (!input.anchor) {
    return { ...base, ledgerBalance: null, difference: null, state: "missing_anchor" };
  }
  if (!input.historyComplete) {
    return { ...base, ledgerBalance: null, difference: null, state: "incomplete_history" };
  }

  const transactionTotal = input.transactions
    .filter((transaction) => transaction.date > input.anchor!.snapshotDate)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const direction = isLiabilityAccount(input.account.type, input.account.subtype) ? 1 : -1;
  const ledgerBalance = roundCurrency(
    input.anchor.currentBalance + direction * transactionTotal,
  );
  const difference = roundCurrency(input.account.currentBalance - ledgerBalance);
  return {
    ...base,
    ledgerBalance,
    difference,
    state: Math.abs(difference) < 0.01 ? "balanced" : "difference",
  };
}

async function latestJob(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  jobType: "transactions" | "investments",
  successfulOnly: boolean,
): Promise<SyncJobRow | null> {
  let query = supabase
    .from("sync_jobs")
    .select("status, updated_at, last_error")
    .eq("user_id", userId)
    .eq("plaid_item_id", itemId)
    .eq("job_type", jobType);
  if (successfulOnly) query = query.eq("status", "done");
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SyncJobRow | null) ?? null;
}

async function transactionBoundary(
  supabase: SupabaseClient,
  userId: string,
  accountIds: string[],
  ascending: boolean,
): Promise<string | null> {
  if (accountIds.length === 0) return null;
  const { data, error } = await supabase
    .from("transactions")
    .select("date")
    .eq("user_id", userId)
    .in("account_id", accountIds)
    .order("date", { ascending })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { date?: string } | null)?.date ?? null;
}

async function loadAccounts(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccountRow[]> {
  const rows: AccountRow[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from("accounts")
      .select("id, plaid_item_id, name, mask, type, subtype, current_balance, updated_at")
      .eq("user_id", userId)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as AccountRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

async function loadReconciliation(
  supabase: SupabaseClient,
  userId: string,
  account: AccountRow,
): Promise<AccountReconciliation> {
  const { data: anchorRow, error: anchorError } = await supabase
    .from("account_balance_snapshots")
    .select("snapshot_date, current_balance")
    .eq("user_id", userId)
    .eq("account_id", account.id)
    .order("snapshot_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (anchorError) throw anchorError;
  const rawAnchor = anchorRow as
    | { snapshot_date: string; current_balance: number | string | null }
    | null;
  const anchorBalance = rawAnchor?.current_balance == null ? null : Number(rawAnchor.current_balance);
  const anchor =
    rawAnchor && anchorBalance !== null && Number.isFinite(anchorBalance)
      ? { snapshotDate: rawAnchor.snapshot_date, currentBalance: anchorBalance }
      : null;

  const transactions: ReconciliationTransaction[] = [];
  let historyComplete = true;
  if (anchor) {
    for (let page = 0; page < MAX_TRANSACTION_PAGES; page += 1) {
      const from = page * PAGE_SIZE;
      const { data, error } = await supabase
        .from("transactions")
        .select("date, amount")
        .eq("user_id", userId)
        .eq("account_id", account.id)
        .gt("date", anchor.snapshotDate)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const batch = (data ?? []) as Array<{ date: string; amount: number | string }>;
      transactions.push(
        ...batch.map((row) => ({ date: row.date, amount: Number(row.amount) })),
      );
      if (batch.length < PAGE_SIZE) break;
      if (page === MAX_TRANSACTION_PAGES - 1) historyComplete = false;
    }
  }

  const currentBalance =
    account.current_balance == null ? null : Number(account.current_balance);
  return buildAccountReconciliation({
    account: {
      id: account.id,
      plaidItemId: account.plaid_item_id,
      name: account.name ?? "Account",
      mask: account.mask,
      type: account.type,
      subtype: account.subtype,
      currentBalance:
        currentBalance !== null && Number.isFinite(currentBalance) ? currentBalance : null,
      updatedAt: account.updated_at,
    },
    anchor,
    transactions,
    historyComplete,
  });
}

export async function loadInstitutionObservability(
  supabase: SupabaseClient,
  userId: string,
  items: SafeItemRow[],
  now = new Date(),
): Promise<{
  institutions: InstitutionSyncHealth[];
  reconciliations: AccountReconciliation[];
}> {
  const accounts = await loadAccounts(supabase, userId);
  const accountsByItem = new Map<string, AccountRow[]>();
  for (const account of accounts) {
    const rows = accountsByItem.get(account.plaid_item_id) ?? [];
    rows.push(account);
    accountsByItem.set(account.plaid_item_id, rows);
  }

  const institutions = await Promise.all(
    items.map(async (item): Promise<InstitutionSyncHealth> => {
      const itemAccounts = accountsByItem.get(item.id) ?? [];
      const accountIds = itemAccounts.map((account) => account.id);
      const [transactionLatest, transactionSuccess, investmentLatest, investmentSuccess, oldest, newest] =
        await Promise.all([
          latestJob(supabase, userId, item.id, "transactions", false),
          latestJob(supabase, userId, item.id, "transactions", true),
          latestJob(supabase, userId, item.id, "investments", false),
          latestJob(supabase, userId, item.id, "investments", true),
          transactionBoundary(supabase, userId, accountIds, true),
          transactionBoundary(supabase, userId, accountIds, false),
        ]);
      const updatedTimestamps = itemAccounts
        .map((account) => account.updated_at)
        .filter((value): value is string => validTimestamp(value) !== null)
        .sort();
      return {
        plaidItemId: item.id,
        institutionName: item.institution_name ?? "Bank",
        transactions: deriveProductSyncHealth({
          itemStatus: item.status,
          itemErrorCode: item.error_code,
          latestJob: transactionLatest,
          latestSuccessfulJob: transactionSuccess,
          now,
        }),
        investments: deriveProductSyncHealth({
          itemStatus: item.status,
          itemErrorCode: item.error_code,
          latestJob: investmentLatest,
          latestSuccessfulJob: investmentSuccess,
          now,
        }),
        accountsUpdatedAt: updatedTimestamps.at(-1) ?? null,
        oldestTransactionDate: oldest,
        newestTransactionDate: newest,
      };
    }),
  );
  const rawReconciliations = await Promise.all(
    accounts.map((account) => loadReconciliation(supabase, userId, account)),
  );
  const institutionById = new Map(
    institutions.map((institution) => [institution.plaidItemId, institution]),
  );
  const reconciliations = rawReconciliations.map((row) => {
    const institution = institutionById.get(row.plaidItemId);
    return {
      ...row,
      oldestTransactionDate: institution?.oldestTransactionDate ?? null,
      newestTransactionDate: institution?.newestTransactionDate ?? null,
    };
  });
  return { institutions, reconciliations };
}
