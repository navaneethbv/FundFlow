import "server-only";
import type { Transaction, RemovedTransaction, AccountBase } from "plaid";
import { getPlaidClient } from "@/lib/plaid";
import { createServiceClient } from "@/lib/supabase/service";
import {
  decryptItemTokenAndUpgrade,
  upsertAccounts,
  getAccountIdMap,
  clearItemRepairCursor,
  completeItemCursor,
  updateItemRepairCursor,
  setItemStatus,
  listActiveItems,
} from "@/lib/plaid-service";
import type { PlaidItemRow } from "@/lib/types";
import { logError } from "@/lib/log";
import { createNotification } from "@/lib/notifications";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";
import { formatCurrency } from "@/lib/format";
import {
  recordCursorAttempt,
  recordCursorSuccess,
  recordCursorPartialSuccess,
  recordCursorFailure,
} from "@/lib/cursor-health";
import { REPAIR_MAX_PAGES } from "@/lib/repair";

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
}

/**
 * How long a crashed run's `syncing_at` claim is honored before another run
 * may reclaim the item. Long enough that a slow sync finishes well inside it,
 * short enough that a crashed run doesn't stall the item for long.
 */
const STALE_SYNC_SECONDS = 5 * 60;

const NOOP_RESULT: SyncResult = { added: 0, modified: 0, removed: 0 };

function mapTransactionRow(
  userId: string,
  accountDbId: string,
  txn: Transaction,
) {
  return {
    user_id: userId,
    account_id: accountDbId,
    plaid_transaction_id: txn.transaction_id,
    amount: txn.amount,
    iso_currency_code: txn.iso_currency_code ?? null,
    date: txn.date,
    authorized_date: txn.authorized_date ?? null,
    // Plaid marks `name` (raw institution description) as a legacy field, but it
    // is still returned and is our best fallback when merchant_name is absent.
    // Read it through a non-deprecated shape to keep the value without the warning.
    name: (txn as { name?: string | null }).name ?? null,
    merchant_name: txn.merchant_name ?? null,
    pfc_primary: txn.personal_finance_category?.primary ?? null,
    pfc_detailed: txn.personal_finance_category?.detailed ?? null,
    payment_channel: txn.payment_channel ?? null,
    pending: txn.pending ?? false,
  };
}

/**
 * Incrementally sync one item's transactions via /transactions/sync.
 *
 * Idempotency: transactions are upserted on the unique plaid_transaction_id, and
 * the cursor is only persisted after a full successful sync. If a run fails
 * mid-way, re-running from the previous cursor re-applies the same pages, and
 * the upserts produce no duplicates.
 */
export async function syncItemTransactions(
  item: PlaidItemRow,
): Promise<SyncResult> {
  const supabase = createServiceClient();

  // Serialize per item: only one run may own an item's sync at a time, so
  // overlapping triggers (webhook, cron, manual sync, auto-refresh, exchange)
  // can't double-spend Plaid API calls, duplicate notifications, or regress
  // the cursor. A stale claim from a crashed run is reclaimed automatically.
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_item_sync",
    {
      p_item_id: item.id,
      p_stale_seconds: STALE_SYNC_SECONDS,
    },
  );
  if (claimError) {
    // Never let the guard break a sync: proceed, just without the claim.
    logError("sync.claim", claimError);
  } else if (claimed === false) {
    // Another run owns this item right now — skip; it will persist the cursor.
    return NOOP_RESULT;
  }
  const holdsClaim = !claimError && claimed === true;

  try {
    // Record the attempt on the item row before touching Plaid, so a crashed
    // run is visible even when no sync_jobs row completes. Best-effort: never
    // let observability break the sync itself.
    await recordCursorAttempt(supabase, {
      userId: item.user_id,
      itemDbId: item.id,
      nowIso: new Date().toISOString(),
    }).catch((error) => logError("sync.cursor-attempt", error));

    const outcome = await syncItemTransactionsInner(item, supabase);
    const cursorRecord = {
      userId: item.user_id,
      itemDbId: item.id,
      nowIso: new Date().toISOString(),
    };
    if (outcome.completed) {
      await recordCursorSuccess(supabase, cursorRecord).catch((error) =>
        logError("sync.cursor-success", error),
      );
    } else {
      await recordCursorPartialSuccess(supabase, {
        ...cursorRecord,
        startedWithoutCursor: !item.sync_cursor,
        priorSuccess: Boolean(item.last_sync_success_at),
      }).catch((error) => logError("sync.cursor-partial", error));
    }
    return outcome.result;
  } catch (error) {
    await recordCursorFailure(supabase, {
      userId: item.user_id,
      itemDbId: item.id,
      startedWithoutCursor: !item.sync_cursor,
      priorSuccess: Boolean(item.last_sync_success_at),
      nowIso: new Date().toISOString(),
    }).catch((failureError) => logError("sync.cursor-failure", failureError));
    throw error;
  } finally {
    // Only release a claim we actually took — releasing on a claim error could
    // clear a legitimate in-progress run's marker.
    if (holdsClaim) {
      try {
        await supabase.rpc("release_item_sync", { p_item_id: item.id });
      } catch (err) {
        logError("sync.release", err);
      }
    }
  }
}

async function notifySyncedTransactions(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  rows: ReturnType<typeof mapTransactionRow>[],
): Promise<void> {
  const { data: alertPref } = await supabase
    .from("alert_preferences")
    .select("large_transaction_threshold")
    .eq("user_id", userId)
    .maybeSingle();
  const largeThreshold = Number(alertPref?.large_transaction_threshold ?? 500);
  for (const row of rows) {
    if (row.amount >= largeThreshold) {
      await createNotification(
        userId,
        "large_transaction",
        {
          title: `Large transaction: ${row.merchant_name || row.name || "Unknown"}`,
          body: `A transaction of ${formatCurrency(row.amount)} was recorded at ${row.merchant_name || row.name || "Unknown"} on ${row.date}.`,
        },
        row.plaid_transaction_id,
        "exact",
      ).catch((err) => logError("sync.large_txn_notification", err));
    }
  }
  try {
    const { data: cancelledRows } = await supabase
      .from("cancelled_subscriptions")
      .select("merchant")
      .eq("user_id", userId);
    const cancelled = new Set(
      (cancelledRows ?? []).map((row) => (row.merchant as string).trim().toLowerCase()),
    );
    for (const row of rows) {
      const merchant = (row.merchant_name || row.name || "").trim();
      if (!merchant || row.amount <= 0 || !cancelled.has(merchant.toLowerCase())) continue;
      await createNotification(
        userId,
        "cancellation_watch",
        {
          title: `Charged after cancellation: ${merchant}`,
          body: `${merchant} charged ${formatCurrency(row.amount)} on ${row.date} after you marked it cancelled. Dispute or re-cancel.`,
        },
        merchant,
      ).catch((err) => logError("sync.cancellation_watch", err));
    }
  } catch (watchError) {
    logError("sync.cancellation_watch", watchError);
  }
}

interface TransactionSyncPage {
  added: Transaction[];
  modified: Transaction[];
  removed: RemovedTransaction[];
  accounts: AccountBase[];
  next_cursor: string;
  has_more: boolean;
}

async function applyTransactionPage(
  item: PlaidItemRow,
  supabase: ReturnType<typeof createServiceClient>,
  data: TransactionSyncPage,
  notify: boolean,
): Promise<SyncResult> {
  await upsertAccounts(item.user_id, item.id, data.accounts);
  const accountMap = await getAccountIdMap(item.user_id);
  const changed = [...data.added, ...data.modified];
  const missingAccount = changed.find((txn) => !accountMap.has(txn.account_id));
  if (missingAccount) {
    throw new Error(
      `Unknown Plaid account ${missingAccount.account_id}; cursor was not advanced`,
    );
  }
  const upsertRows = changed.map((txn) =>
    mapTransactionRow(item.user_id, accountMap.get(txn.account_id)!, txn),
  );
  if (upsertRows.length > 0) {
    const { error } = await supabase
      .from("transactions")
      .upsert(upsertRows, { onConflict: "plaid_transaction_id" });
    if (error) throw error;
    if (notify) {
      await notifySyncedTransactions(supabase, item.user_id, upsertRows);
    }
  }
  const removedIds = data.removed
    .map((row) => row.transaction_id)
    .filter((id): id is string => Boolean(id));
  if (removedIds.length > 0) {
    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("user_id", item.user_id)
      .in("plaid_transaction_id", removedIds);
    if (error) throw error;
  }
  return {
    added: data.added.length,
    modified: data.modified.length,
    removed: data.removed.length,
  };
}

interface TransactionSyncLoopOptions {
  /** Hard page bound, or null to drain until `has_more` is false. */
  maxPages: number | null;
  /** Emit large-transaction notifications for the rows applied. */
  notify: boolean;
  mode: "routine" | "repair";
}

interface TransactionSyncLoopOutcome {
  result: SyncResult;
  /** True only when `has_more` became false. */
  completed: boolean;
  pagesCompleted: number;
}

function shouldFetchTransactionPage(
  hasMore: boolean,
  pagesCompleted: number,
  maxPages: number | null,
): boolean {
  return hasMore && (maxPages === null || pagesCompleted < maxPages);
}

function nextTransactionCursor(
  cursor: string | undefined,
  page: TransactionSyncPage,
): string | undefined {
  if (!page.next_cursor && page.has_more) {
    throw new Error("Plaid returned an empty next cursor");
  }
  return page.next_cursor || cursor;
}

async function recoverTransactionSyncError(
  item: PlaidItemRow,
  mode: TransactionSyncLoopOptions["mode"],
  error: unknown,
): Promise<void> {
  if (
    mode === "repair" &&
    plaidErrorCode(error) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"
  ) {
    await clearItemRepairCursor(item.user_id, item.id);
  }
}

async function persistTransactionSyncCursor(
  item: PlaidItemRow,
  mode: TransactionSyncLoopOptions["mode"],
  cursor: string | undefined,
  committedCursor: string | undefined,
  hasMore: boolean,
): Promise<void> {
  if (cursor && hasMore && mode === "repair") {
    await updateItemRepairCursor(item.user_id, item.id, cursor);
  } else if (cursor && !hasMore && cursor !== committedCursor) {
    await completeItemCursor(item.user_id, item.id, cursor);
  } else if (!hasMore && item.repair_sync_started_at) {
    await clearItemRepairCursor(item.user_id, item.id);
  }
}

/**
 * Drive Plaid's `/transactions/sync` pagination for one item.
 *
 * Two rules from Plaid's pagination contract shape this loop:
 *
 * 1. The loop must run until `has_more` is false. A caller that stops early
 *    leaves the item behind by however many pages it skipped, so only the
 *    explicitly bounded repair path passes a `maxPages`; the routine sync
 *    passes null and drains.
 * 2. The committed cursor must stay the one the update chain *began* with
 *    until `has_more` is false. Bounded Repair runs keep their intermediate
 *    position in a separate repair cursor, so a mutation error can discard it
 *    and restart from the committed cursor exactly as Plaid requires.
 *
 *    Within one run, the cursor also stays in memory until a clean exit. A
 *    thrown request or page write therefore retries that run's pages without
 *    skipping any updates.
 *
 * The row writes themselves stay per page: they are keyed by
 * plaid_transaction_id, so replaying a page after a failure is idempotent.
 */
async function runTransactionSyncLoop(
  item: PlaidItemRow,
  supabase: ReturnType<typeof createServiceClient>,
  options: TransactionSyncLoopOptions,
): Promise<TransactionSyncLoopOutcome> {
  const plaid = getPlaidClient();
  const accessToken = await decryptItemTokenAndUpgrade(item);

  if (options.mode === "routine" && item.repair_sync_started_at) {
    await clearItemRepairCursor(item.user_id, item.id);
  }
  const committedCursor = item.sync_cursor ?? undefined;
  const startCursor =
    options.mode === "repair" && item.repair_sync_started_at
      ? (item.repair_sync_cursor ?? committedCursor)
      : committedCursor;
  let cursor = startCursor;
  let hasMore = true;
  let pagesCompleted = 0;
  const result: SyncResult = { added: 0, modified: 0, removed: 0 };

  try {
    while (shouldFetchTransactionPage(hasMore, pagesCompleted, options.maxPages)) {
      const response = await plaid.transactionsSync({
        access_token: accessToken,
        cursor,
      });
      const data = response.data as TransactionSyncPage;
      const pageResult = await applyTransactionPage(item, supabase, data, options.notify);
      result.added += pageResult.added;
      result.modified += pageResult.modified;
      result.removed += pageResult.removed;
      cursor = nextTransactionCursor(cursor, data);
      hasMore = data.has_more;
      pagesCompleted += 1;
    }
  } catch (error) {
    await recoverTransactionSyncError(item, options.mode, error);
    throw error;
  }

  await persistTransactionSyncCursor(
    item,
    options.mode,
    cursor,
    committedCursor,
    hasMore,
  );
  await setItemStatus(item.user_id, item.id, "active", null);
  return { result, completed: !hasMore, pagesCompleted };
}

async function syncItemTransactionsInner(
  item: PlaidItemRow,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<{ result: SyncResult; completed: boolean }> {
  const { result, completed } = await runTransactionSyncLoop(item, supabase, {
    maxPages: null,
    notify: true,
    mode: "routine",
  });
  return { result, completed };
}

/** Pull the Plaid error code out of an Axios-shaped error, if there is one. */
function plaidErrorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { error_code?: unknown } } })
    ?.response?.data?.error_code;
  return typeof code === "string" ? code : null;
}

export interface RepairBackfillOptions {
  /** Hard cap on pages fetched in a single repair run. */
  maxPages: number;
}

export interface RepairBackfillResult {
  pagesCompleted: number;
  maxPages: number;
  /** True only when has_more became false inside the bound. */
  completed: boolean;
  added: number;
  modified: number;
  removed: number;
}

export class ItemSyncInProgressError extends Error {
  constructor() {
    super("An item sync is already in progress");
    this.name = "ItemSyncInProgressError";
  }
}

/**
 * Bounded historical reconciliation for the authenticated repair action.
 *
 * Runs the same pagination loop as the routine sync, but capped at `maxPages`
 * so one repair cannot spin unboundedly against a long backlog. Progress is
 * durable in a separate repair cursor, while sync_cursor remains the chain's
 * recovery point until has_more is false. A mutation error clears only the
 * repair cursor, so the next run restarts the full chain from sync_cursor as
 * Plaid requires.
 *
 * Explicit Plaid tombstones (the `removed` array) are applied even when the
 * run is bounded — they are listed removals, not omissions. Transactions that
 * merely fail to appear in a partial response are never deleted.
 */
export async function backfillItemTransactions(
  item: PlaidItemRow,
  options?: RepairBackfillOptions,
): Promise<RepairBackfillResult> {
  const supabase = createServiceClient();
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_item_sync",
    {
      p_item_id: item.id,
      p_stale_seconds: STALE_SYNC_SECONDS,
    },
  );
  if (claimError) throw claimError;
  if (claimed !== true) throw new ItemSyncInProgressError();
  try {
    return await backfillClaimedItemTransactions(item, options, supabase);
  } finally {
    const { error } = await supabase.rpc("release_item_sync", {
      p_item_id: item.id,
    });
    if (error) logError("repair.release", error);
  }
}

async function backfillClaimedItemTransactions(
  item: PlaidItemRow,
  options: RepairBackfillOptions | undefined,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<RepairBackfillResult> {
  await recordCursorAttempt(supabase, {
    userId: item.user_id,
    itemDbId: item.id,
    nowIso: new Date().toISOString(),
  }).catch((error) => logError("repair.cursor-attempt", error));

  const maxPages = options?.maxPages ?? REPAIR_MAX_PAGES;
  const { result, completed, pagesCompleted } = await runTransactionSyncLoop(
    item,
    supabase,
    { maxPages, notify: false, mode: "repair" },
  );

  const nowIso = new Date().toISOString();
  if (completed) {
    await recordCursorSuccess(supabase, {
      userId: item.user_id,
      itemDbId: item.id,
      nowIso,
    }).catch((error) => logError("repair.cursor-success", error));
  } else {
    await recordCursorPartialSuccess(supabase, {
      userId: item.user_id,
      itemDbId: item.id,
      startedWithoutCursor: !item.sync_cursor,
      priorSuccess: Boolean(item.last_sync_success_at),
      nowIso,
    }).catch((error) => logError("repair.cursor-partial", error));
  }

  return {
    pagesCompleted,
    maxPages,
    completed,
    added: result.added,
    modified: result.modified,
    removed: result.removed,
  };
}

/**
 * Best-effort run bookkeeping in sync_jobs (observability, must never break a
 * sync). Returns the job row id, or null if recording failed.
 */
async function recordJobStart(
  userId: string,
  itemDbId: string,
): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("sync_jobs")
      .insert({
        user_id: userId,
        plaid_item_id: itemDbId,
        status: "running",
        attempts: 1,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  } catch (error) {
    logError("sync.job-record", error);
    return null;
  }
}

async function recordJobEnd(
  jobId: string | null,
  status: "done" | "failed",
  lastError: string | null = null,
): Promise<void> {
  if (!jobId) return;
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("sync_jobs")
      .update({ status, last_error: lastError })
      .eq("id", jobId);
    if (error) throw error;
  } catch (error) {
    logError("sync.job-record", error);
  }
}

/** Sync every active item for a user. Per-item failures are isolated. */
export async function syncAllForUser(userId: string): Promise<SyncResult> {
  const items = await listActiveItems(userId);
  const total: SyncResult = { added: 0, modified: 0, removed: 0 };

  for (const item of items) {
    const jobId = await recordJobStart(userId, item.id);
    try {
      const result = await syncItemTransactions(item);
      total.added += result.added;
      total.modified += result.modified;
      total.removed += result.removed;
      await recordJobEnd(jobId, "done");
    } catch (error) {
      logError("sync.item", error);
      // Keep the real Plaid code (e.g. ITEM_LOGIN_REQUIRED) so Settings can
      // offer the right fix (reconnect) instead of a generic failure.
      const code = plaidErrorCode(error) ?? "sync_failed";
      await setItemStatus(item.user_id, item.id, "error", code).catch(() => {});
      await recordJobEnd(jobId, "failed", code);

      // Emit broken bank/sync failure notification
      await createNotification(
        userId,
        "broken_bank",
        {
          title: `Bank connection issue: ${item.institution_name || "Bank"}`,
          body: `The connection to ${item.institution_name || "your bank"} needs to be updated (error: ${code}).`,
        },
        item.id,
      ).catch((err) => logError("sync.broken_bank_notification", err));
    }
  }
  // Fresh transactions/balances just landed — drop this user's cached dashboard
  // so the next render recomputes instead of serving pre-sync numbers.
  invalidateDashboardCache(userId);
  return total;
}
