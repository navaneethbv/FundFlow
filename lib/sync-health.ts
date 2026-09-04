import type { SupabaseClient } from "@supabase/supabase-js";
import { isLiabilityAccount } from "@/lib/account-balance";
import { normalizeExternalDisplayText } from "@/lib/external-display-text";
import {
  deriveCursorHealth,
  safeErrorCode,
  type ItemCursorHealth,
} from "@/lib/cursor-health";

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const PAGE_SIZE = 1_000;

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
  /** Item-level cursor state, or null when the item predates the migration. */
  cursor: ItemCursorHealth | null;
}

/**
 * Whether the local ledger can be trusted to hold every transaction the
 * provider has for this item.
 *
 * Reports incompleteness only on positive evidence of a gap. An item that has
 * not recorded a sync attempt yet carries nothing but the migration's column
 * defaults, so it is treated as unknown-but-usable rather than flagged — a
 * freshly migrated project would otherwise show every account as "History
 * incomplete" until its next nightly sync stamps the flags for real.
 */
export function isHistoryComplete(cursor: ItemCursorHealth): boolean {
  if (!cursor.lastAttemptAt) return true;
  return (
    cursor.state === "healthy" &&
    cursor.lastSyncCompletedPages &&
    !cursor.initialHistoryIncomplete &&
    !cursor.cursorResetDetectedAt
  );
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
  /**
   * Cursor-health facts recorded on the item by lib/sync.ts. Optional so a
   * caller that predates the migration still renders; a missing flag is read
   * as "no known gap" rather than inventing one.
   */
  last_sync_attempt_at?: string | null;
  last_sync_success_at?: string | null;
  last_sync_completed_pages?: boolean | null;
  initial_history_incomplete?: boolean | null;
  cursor_reset_detected_at?: string | null;
}

/** The columns loadInstitutionObservability reads off plaid_items. */
export const SYNC_HEALTH_ITEM_COLUMNS =
  "id, institution_name, status, error_code, last_sync_attempt_at, last_sync_success_at, last_sync_completed_pages, initial_history_incomplete, cursor_reset_detected_at";

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

interface ReconciliationAggregateRow {
  account_id: string;
  snapshot_date: string | null;
  snapshot_balance_cents: number | string | null;
  post_anchor_total_cents: number | string;
  oldest_transaction_date: string | null;
  newest_transaction_date: string | null;
}

const PRODUCT_UNAVAILABLE_CODES = new Set([
  "INVALID_PRODUCT",
  "NO_INVESTMENT_ACCOUNTS",
  "PRODUCTS_NOT_SUPPORTED",
  "no_investment_product",
]);

const RATE_LIMIT_CODES = new Set(["RATE_LIMIT", "RATE_LIMIT_EXCEEDED", "rate_limited"]);

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

function toCents(value: number): number {
  return Math.round(value * 100);
}

export function buildAccountReconciliation(input: Readonly<{
  account: ReconciliationAccount;
  anchor: SnapshotAnchor | null;
  transactionTotalCents: number;
  historyComplete: boolean;
  coverage?: { oldest: string | null; newest: string | null };
}>): AccountReconciliation {
  const base = {
    accountId: input.account.id,
    plaidItemId: input.account.plaidItemId,
    accountName: normalizeExternalDisplayText(input.account.name) ?? "Unnamed account",
    mask: input.account.mask,
    providerBalance: input.account.currentBalance,
    anchorDate: input.anchor?.snapshotDate ?? null,
    oldestTransactionDate: input.coverage?.oldest ?? null,
    newestTransactionDate: input.coverage?.newest ?? null,
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

  const direction = isLiabilityAccount(input.account.type, input.account.subtype) ? 1 : -1;
  const ledgerCents =
    toCents(input.anchor.currentBalance) + direction * input.transactionTotalCents;
  const providerCents = toCents(input.account.currentBalance);
  const differenceCents = providerCents - ledgerCents;
  return {
    ...base,
    ledgerBalance: ledgerCents / 100,
    difference: differenceCents / 100,
    state: differenceCents === 0 ? "balanced" : "difference",
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

function toReconciliationAccount(account: AccountRow): ReconciliationAccount {
  const parsedBalance =
    account.current_balance == null ? null : Number(account.current_balance);
  return {
    id: account.id,
    plaidItemId: account.plaid_item_id,
    name: account.name ?? "Account",
    mask: account.mask,
    type: account.type,
    subtype: account.subtype,
    currentBalance:
      parsedBalance !== null && Number.isFinite(parsedBalance) ? parsedBalance : null,
    updatedAt: account.updated_at,
  };
}

async function loadReconciliationAggregates(
  supabase: SupabaseClient,
): Promise<ReconciliationAggregateRow[]> {
  const rows: ReconciliationAggregateRow[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .rpc("account_reconciliation_aggregates")
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      // Keep Settings available during the migration-before-code rollout
      // window. Every other RPC failure remains visible to the caller.
      if ((error as { code?: unknown }).code === "PGRST202") return rows;
      throw error;
    }
    const batch = (data ?? []) as ReconciliationAggregateRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
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
  const aggregateRows = await loadReconciliationAggregates(supabase);
  const aggregateByAccount = new Map(
    aggregateRows.map((row) => [row.account_id, row]),
  );
  const accountsByItem = new Map<string, AccountRow[]>();
  for (const account of accounts) {
    const rows = accountsByItem.get(account.plaid_item_id) ?? [];
    rows.push(account);
    accountsByItem.set(account.plaid_item_id, rows);
  }

  // Only items that actually carry the cursor-health columns get an entry;
  // a caller selecting the older column set leaves the map empty and both
  // consumers below fall back to their pre-migration behaviour.
  const cursorHealthByItem = new Map<string, ItemCursorHealth>();
  for (const item of items) {
    if (item.last_sync_completed_pages === undefined) continue;
    cursorHealthByItem.set(
      item.id,
      deriveCursorHealth({
        plaidItemId: item.id,
        itemStatus: item.status,
        itemErrorCode: item.error_code,
        lastAttemptAt: item.last_sync_attempt_at ?? null,
        lastSuccessAt: item.last_sync_success_at ?? null,
        lastSyncCompletedPages: item.last_sync_completed_pages ?? false,
        initialHistoryIncomplete: item.initial_history_incomplete ?? false,
        cursorResetDetectedAt: item.cursor_reset_detected_at ?? null,
        now,
      }),
    );
  }

  const institutions = await Promise.all(
    items.map(async (item): Promise<InstitutionSyncHealth> => {
      const itemAccounts = accountsByItem.get(item.id) ?? [];
      const itemAggregates = itemAccounts
        .map((account) => aggregateByAccount.get(account.id))
        .filter((row): row is ReconciliationAggregateRow => row !== undefined);
      const oldest = itemAggregates
        .map((row) => row.oldest_transaction_date)
        .filter((value): value is string => value !== null)
        .sort((left, right) => left.localeCompare(right))
        .at(0) ?? null;
      const newest = itemAggregates
        .map((row) => row.newest_transaction_date)
        .filter((value): value is string => value !== null)
        .sort((left, right) => right.localeCompare(left))
        .at(0) ?? null;
      const [transactionLatest, transactionSuccess, investmentLatest, investmentSuccess] =
        await Promise.all([
          latestJob(supabase, userId, item.id, "transactions", false),
          latestJob(supabase, userId, item.id, "transactions", true),
          latestJob(supabase, userId, item.id, "investments", false),
          latestJob(supabase, userId, item.id, "investments", true),
        ]);
      const updatedTimestamps = itemAccounts
        .map((account) => account.updated_at)
        .filter((value): value is string => validTimestamp(value) !== null)
        .sort((left, right) => left.localeCompare(right));
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
        cursor: cursorHealthByItem.get(item.id) ?? null,
      };
    }),
  );
  const reconciliations = accounts.map((account) => {
    const aggregate = aggregateByAccount.get(account.id);
    const snapshotBalanceCents = Number(aggregate?.snapshot_balance_cents);
    const transactionTotalCents = Number(aggregate?.post_anchor_total_cents ?? 0);
    const anchor = aggregate?.snapshot_date &&
      aggregate.snapshot_balance_cents !== null &&
      Number.isFinite(snapshotBalanceCents)
      ? {
          snapshotDate: aggregate.snapshot_date,
          currentBalance: snapshotBalanceCents / 100,
        }
      : null;
    // A ledger balance is only meaningful when every transaction after the
    // anchor is actually present. The owning item's cursor health is the one
    // durable record of that, so a truncated or reset sync reports
    // "incomplete_history" instead of a confidently wrong difference.
    const cursor = cursorHealthByItem.get(account.plaid_item_id);
    return buildAccountReconciliation({
      account: toReconciliationAccount(account),
      anchor,
      transactionTotalCents: Number.isFinite(transactionTotalCents)
        ? transactionTotalCents
        : 0,
      historyComplete: cursor ? isHistoryComplete(cursor) : true,
      coverage: {
        oldest: aggregate?.oldest_transaction_date ?? null,
        newest: aggregate?.newest_transaction_date ?? null,
      },
    });
  });
  return { institutions, reconciliations };
}
