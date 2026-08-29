import "server-only";
import type { Transaction, RemovedTransaction, AccountBase } from "plaid";
import { getPlaidClient } from "@/lib/plaid";
import { createServiceClient } from "@/lib/supabase/service";
import {
  decryptItemTokenAndUpgrade,
  upsertAccounts,
  getAccountIdMap,
  updateItemCursor,
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
  recordCursorFailure,
} from "@/lib/cursor-health";

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

    const result = await syncItemTransactionsInner(item, supabase);
    await recordCursorSuccess(supabase, {
      userId: item.user_id,
      itemDbId: item.id,
      nowIso: new Date().toISOString(),
    }).catch((error) => logError("sync.cursor-success", error));
    return result;
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

async function syncItemTransactionsInner(
  item: PlaidItemRow,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<SyncResult> {
  const plaid = getPlaidClient();
  const accessToken = await decryptItemTokenAndUpgrade(item);

  let cursor = item.sync_cursor ?? undefined;
  let hasMore = true;

  const added: Transaction[] = [];
  const modified: Transaction[] = [];
  const removed: RemovedTransaction[] = [];
  let latestAccounts: AccountBase[] = [];

  while (hasMore) {
    const response = await plaid.transactionsSync({
      access_token: accessToken,
      cursor,
    });
    const data = response.data;

    added.push(...data.added);
    modified.push(...data.modified);
    removed.push(...data.removed);
    // Plaid omits `accounts` on later pages; only take the page that has them
    // so a multi-page sync can't finish with an empty array and silently stop
    // refreshing balances.
    if (data.accounts.length > 0) latestAccounts = data.accounts;

    cursor = data.next_cursor;
    hasMore = data.has_more;
  }

  // Refresh accounts (and balances) first so transactions can FK to them.
  await upsertAccounts(item.user_id, item.id, latestAccounts);
  const accountMap = await getAccountIdMap(item.user_id);

  const upsertRows = [...added, ...modified]
    .map((txn) => {
      const accountDbId = accountMap.get(txn.account_id);
      return accountDbId
        ? mapTransactionRow(item.user_id, accountDbId, txn)
        : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (upsertRows.length > 0) {
    const { error } = await supabase
      .from("transactions")
      .upsert(upsertRows, { onConflict: "plaid_transaction_id" });
    if (error) throw error;

    await notifySyncedTransactions(supabase, item.user_id, upsertRows);
  }

  if (removed.length > 0) {
    const removedIds = removed
      .map((r) => r.transaction_id)
      .filter((id): id is string => Boolean(id));
    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("user_id", item.user_id)
      .in("plaid_transaction_id", removedIds);
    if (error) throw error;
  }

  // Persist cursor only after everything applied successfully.
  if (cursor) await updateItemCursor(item.user_id, item.id, cursor);
  await setItemStatus(item.user_id, item.id, "active", null);

  return { added: added.length, modified: modified.length, removed: removed.length };
}

/** Pull the Plaid error code out of an Axios-shaped error, if there is one. */
function plaidErrorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { error_code?: unknown } } })
    ?.response?.data?.error_code;
  return typeof code === "string" ? code : null;
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
