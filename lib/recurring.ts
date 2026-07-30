import "server-only";
import type { TransactionStream } from "plaid";
import { getPlaidClient } from "@/lib/plaid";
import { createServiceClient } from "@/lib/supabase/service";
import { decryptItemToken, listActiveItems } from "@/lib/plaid-service";
import type { PlaidItemRow } from "@/lib/types";
import { logError } from "@/lib/log";
import { diffRecurringStreams, type RecurringDiff } from "@/lib/insights";
import { createNotification } from "@/lib/notifications";
import { formatCurrency } from "@/lib/format";

function mapStreamRow(
  userId: string,
  itemDbId: string,
  streamType: "inflow" | "outflow",
  stream: TransactionStream,
  accountIdByPlaidId: Map<string, string>,
) {
  return {
    user_id: userId,
    plaid_item_id: itemDbId,
    stream_id: stream.stream_id,
    stream_type: streamType,
    description: stream.description ?? null,
    merchant_name: stream.merchant_name ?? null,
    average_amount: stream.average_amount?.amount ?? null,
    last_amount: stream.last_amount?.amount ?? null,
    frequency: stream.frequency ?? null,
    status: stream.status ?? null,
    category: stream.personal_finance_category?.primary ?? null,
    is_active: stream.is_active ?? true,
    account_id: accountIdByPlaidId.get(stream.account_id) ?? null,
    first_date: stream.first_date ?? null,
    last_date: stream.last_date ?? null,
    predicted_next_date: stream.predicted_next_date ?? null,
  };
}

/** Local transaction ids matching a chunk of Plaid transaction ids. */
async function resolveLocalTransactionIds(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  plaidTransactionIds: string[],
): Promise<Map<string, string>> {
  const byPlaidId = new Map<string, string>();
  for (let i = 0; i < plaidTransactionIds.length; i += 500) {
    const chunk = plaidTransactionIds.slice(i, i + 500);
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("transactions")
      .select("id, plaid_transaction_id")
      .eq("user_id", userId)
      .in("plaid_transaction_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      byPlaidId.set(row.plaid_transaction_id as string, row.id as string);
    }
  }
  return byPlaidId;
}

/**
 * Notifies about subscription price hikes and new subscriptions found by
 * diffing a refresh against the stored streams. Best-effort by design: a
 * failed notification must never break the sync that discovered it.
 */
async function notifyRecurringChanges(userId: string, diff: RecurringDiff) {
  for (const hike of diff.priceHikes) {
    try {
      await createNotification(
        userId,
        "price_hike",
        {
          title: `Price increase: ${hike.name}`,
          body: `${hike.name} went from ${formatCurrency(hike.previousAmount)} to ${formatCurrency(hike.newAmount)} (+${hike.pctIncrease}%).`,
        },
        hike.name,
      );
    } catch (error) {
      logError("recurring.alert.price_hike", error);
    }
  }
  for (const stream of diff.newStreams) {
    try {
      await createNotification(
        userId,
        "new_subscription",
        {
          title: `New recurring charge: ${stream.name}`,
          body: `A new recurring charge of ${formatCurrency(stream.amount)} from ${stream.name} was detected. If you don't recognize it, review your accounts.`,
        },
        stream.name,
      );
    } catch (error) {
      logError("recurring.alert.new_subscription", error);
    }
  }
}

/** Refresh recurring streams (subscriptions + income) for one item. */
export async function refreshRecurringForItem(item: PlaidItemRow): Promise<number> {
  const plaid = getPlaidClient();
  const accessToken = decryptItemToken(item);

  const response = await plaid.transactionsRecurringGet({
    access_token: accessToken,
  });

  const tagged = [
    ...response.data.inflow_streams.map((s) => ({ stream: s, type: "inflow" as const })),
    ...response.data.outflow_streams.map((s) => ({ stream: s, type: "outflow" as const })),
  ];

  // Short-circuit before touching the database at all when there is nothing
  // to persist — a partial/empty response must not trip any downstream
  // account or mark-and-sweep query.
  if (tagged.length === 0) return 0;

  const supabase = createServiceClient();

  const { data: accountRows } = await supabase
    .from("accounts")
    .select("id, plaid_account_id")
    .eq("user_id", item.user_id);
  const accountIdByPlaidId = new Map(
    (accountRows ?? []).map((row) => [row.plaid_account_id as string, row.id as string]),
  );

  const rows = tagged.map(({ stream, type }) =>
    mapStreamRow(item.user_id, item.id, type, stream, accountIdByPlaidId),
  );

  // Snapshot stored amounts before the upsert overwrites them. Service
  // client bypasses RLS, so both filters are load-bearing.
  const { data: existing } = await supabase
    .from("recurring_streams")
    .select("stream_id, last_amount")
    .eq("user_id", item.user_id)
    .eq("plaid_item_id", item.id);

  const { data: upserted, error } = await supabase
    .from("recurring_streams")
    .upsert(rows, { onConflict: "stream_id" })
    .select("id, stream_id");
  if (error) throw error;

  // Mark-and-sweep: a stream that existed for this item but is absent from
  // this full, successful response is no longer current. This only runs
  // after the fetch and upsert above succeeded — a thrown error above skips
  // straight past this block, so a failed or partial refresh changes nothing.
  const currentStreamIds = new Set(rows.map((row) => row.stream_id));
  const staleStreamIds = (existing ?? [])
    .map((row) => row.stream_id as string)
    .filter((streamId) => !currentStreamIds.has(streamId));
  if (staleStreamIds.length > 0) {
    await supabase
      .from("recurring_streams")
      .update({ is_active: false })
      .eq("user_id", item.user_id)
      .in("stream_id", staleStreamIds);
  }

  // Resolve each stream's Plaid transaction ids to local rows and replace
  // the join table's rows for that stream. Ids that don't resolve (older,
  // pruned transactions) are simply omitted.
  const localStreamIdByPlaidStreamId = new Map(
    (upserted ?? []).map((row) => [row.stream_id as string, row.id as string]),
  );
  const allPlaidTransactionIds = [
    ...new Set(tagged.flatMap(({ stream }) => stream.transaction_ids)),
  ];
  const localTransactionIdByPlaidId = await resolveLocalTransactionIds(
    supabase,
    item.user_id,
    allPlaidTransactionIds,
  );

  for (const { stream } of tagged) {
    const recurringStreamId = localStreamIdByPlaidStreamId.get(stream.stream_id);
    if (!recurringStreamId) continue;
    const localTransactionIds = stream.transaction_ids
      .map((plaidId) => localTransactionIdByPlaidId.get(plaidId))
      .filter((id): id is string => Boolean(id));

    await supabase
      .from("recurring_stream_transactions")
      .delete()
      .eq("recurring_stream_id", recurringStreamId);
    if (localTransactionIds.length > 0) {
      await supabase.from("recurring_stream_transactions").insert(
        localTransactionIds.map((transactionId) => ({
          user_id: item.user_id,
          recurring_stream_id: recurringStreamId,
          transaction_id: transactionId,
        })),
      );
    }
  }

  // Diff only when history exists — the first refresh seeds silently
  // instead of announcing every pre-existing subscription as "new".
  const previous = (existing ?? []).map((row) => ({
    streamId: row.stream_id as string,
    lastAmount: row.last_amount === null ? null : Number(row.last_amount),
  }));
  if (previous.length > 0) {
    const diff = diffRecurringStreams(
      previous,
      rows.map((row) => ({
        streamId: row.stream_id,
        streamType: row.stream_type,
        name: row.merchant_name ?? row.description ?? "Unknown",
        lastAmount: row.last_amount,
        isActive: row.is_active,
      })),
    );
    await notifyRecurringChanges(item.user_id, diff);
  }

  return rows.length;
}

/** Refresh recurring streams for all active items of a user. */
export async function refreshRecurringForUser(userId: string): Promise<number> {
  const items = await listActiveItems(userId);
  let count = 0;
  for (const item of items) {
    try {
      count += await refreshRecurringForItem(item);
    } catch (error) {
      logError("recurring.item", error);
    }
  }
  return count;
}
