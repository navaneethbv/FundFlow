import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isDue,
  toPromotedTransactionRow,
} from "@/lib/scheduled-transactions";

/**
 * Cron-side promotion of due scheduled transactions into the ledger.
 *
 * Idempotent by construction: a due row is promoted with a deterministic
 * `scheduled-<id>` plaid_transaction_id via an upsert that ignores conflicts,
 * and the row's status flips to `promoted` afterward — so a re-run (or a
 * crash between insert and status update) converges instead of duplicating.
 *
 * Runs with the service client: `transactions` has no client-write RLS
 * policy (by design, mirroring the manual-transaction route), so every write
 * carries an explicit `user_id` taken from the schedule row itself.
 */

const PROMOTE_BATCH = 500;
const INSERT_CHUNK = 250;

export interface PromotionResult {
  promoted: number;
  failed: string | null;
}

export async function promoteDueScheduledTransactions(
  service: SupabaseClient,
  today: string,
): Promise<PromotionResult> {
  const { data, error } = await service
    .from("scheduled_transactions")
    .select(
      "id, user_id, kind, amount, merchant, scheduled_date, category, account_id, manual_account_id, status",
    )
    .eq("status", "scheduled")
    .lte("scheduled_date", today)
    .order("scheduled_date")
    .limit(PROMOTE_BATCH);
  if (error) return { promoted: 0, failed: error.message };
  const due = (data ?? []).filter(
    (row) =>
      isDue(row as { status: string; scheduled_date: string }, today) &&
      typeof (row as { user_id?: unknown }).user_id === "string",
  );
  if (due.length === 0) return { promoted: 0, failed: null };

  const rows = due.map((row) => toPromotedTransactionRow(String(row.user_id), row));

  let promoted = 0;
  for (let index = 0; index < rows.length; index += INSERT_CHUNK) {
    const chunk = rows.slice(index, index + INSERT_CHUNK);
    const { error: insertError } = await service
      .from("transactions")
      .upsert(chunk, { onConflict: "plaid_transaction_id", ignoreDuplicates: true });
    if (insertError) {
      return { promoted, failed: insertError.message };
    }
    promoted += chunk.length;
  }

  const { error: statusError } = await service
    .from("scheduled_transactions")
    .update({ status: "promoted" })
    .in(
      "id",
      due.map((row) => String(row.id)),
    );
  if (statusError) return { promoted, failed: statusError.message };

  return { promoted, failed: null };
}
