import "server-only";
import type { TransactionStream } from "plaid";
import { getPlaidClient } from "@/lib/plaid";
import { createServiceClient } from "@/lib/supabase/service";
import { decryptItemToken, listActiveItems } from "@/lib/plaid-service";
import type { PlaidItemRow } from "@/lib/types";
import { logError } from "@/lib/log";

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
  const { error } = await supabase
    .from("recurring_streams")
    .upsert(rows, { onConflict: "stream_id" });
  if (error) throw error;

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
