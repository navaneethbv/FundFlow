import "server-only";
import type { Transaction, RemovedTransaction, AccountBase } from "plaid";
import { getPlaidClient } from "@/lib/plaid";
import { createServiceClient } from "@/lib/supabase/service";
import {
  decryptItemToken,
  upsertAccounts,
  getAccountIdMap,
  updateItemCursor,
  setItemStatus,
  listActiveItems,
} from "@/lib/plaid-service";
import type { PlaidItemRow } from "@/lib/types";
import { logError } from "@/lib/log";

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
}

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
    name: txn.name ?? null,
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
  const plaid = getPlaidClient();
  const accessToken = decryptItemToken(item);

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
    latestAccounts = data.accounts;

    cursor = data.next_cursor;
    hasMore = data.has_more;
  }

  const supabase = createServiceClient();

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
  if (cursor) await updateItemCursor(item.id, cursor);
  await setItemStatus(item.id, "active", null);

  return { added: added.length, modified: modified.length, removed: removed.length };
}

/** Sync every active item for a user. Per-item failures are isolated. */
export async function syncAllForUser(userId: string): Promise<SyncResult> {
  const items = await listActiveItems(userId);
  const total: SyncResult = { added: 0, modified: 0, removed: 0 };

  for (const item of items) {
    try {
      const result = await syncItemTransactions(item);
      total.added += result.added;
      total.modified += result.modified;
      total.removed += result.removed;
    } catch (error) {
      logError("sync.item", error);
      await setItemStatus(item.id, "error", "sync_failed").catch(() => {});
    }
  }
  return total;
}
