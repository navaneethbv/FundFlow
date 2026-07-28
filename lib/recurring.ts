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
  };
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

  const rows = [
    ...response.data.inflow_streams.map((s) =>
      mapStreamRow(item.user_id, item.id, "inflow", s),
    ),
    ...response.data.outflow_streams.map((s) =>
      mapStreamRow(item.user_id, item.id, "outflow", s),
    ),
  ];

  if (rows.length === 0) return 0;

  const supabase = createServiceClient();

  // Snapshot stored amounts before the upsert overwrites them. Service
  // client bypasses RLS, so both filters are load-bearing.
  const { data: existing } = await supabase
    .from("recurring_streams")
    .select("stream_id, last_amount")
    .eq("user_id", item.user_id)
    .eq("plaid_item_id", item.id);

  const { error } = await supabase
    .from("recurring_streams")
    .upsert(rows, { onConflict: "stream_id" });
  if (error) throw error;

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
