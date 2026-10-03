import type { SupabaseClient } from "@supabase/supabase-js";
import { IN_FILTER_CHUNK_SIZE } from "@/lib/postgrest-limits";

const QUERY_CHUNK = IN_FILTER_CHUNK_SIZE;

function chunks<T>(values: T[], size = QUERY_CHUNK): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export interface ImportCommitTrackingRow {
  rowId: string;
  plaid_transaction_id: string;
}

export async function loadExistingImportIds(
  service: SupabaseClient,
  rows: ImportCommitTrackingRow[],
  userId: string,
): Promise<Set<string>> {
  const importIdChunks = chunks(rows.map((row) => row.plaid_transaction_id)).filter((chunk) => chunk.length > 0);
  const results = await Promise.all(importIdChunks.map(async (importIdChunk) => {
    const table = service.from("transactions");
    if (typeof (table as unknown as { select?: unknown }).select !== "function") return [] as string[];
    const { data, error } = await table
      .select("plaid_transaction_id")
      .eq("user_id", userId)
      .in("plaid_transaction_id", importIdChunk);
    if (error) throw error;
    return (data ?? [])
      .map((row) => row.plaid_transaction_id)
      .filter((value): value is string => typeof value === "string");
  }));
  return new Set(results.flat());
}

export async function trackImportCommitTransactions(
  service: SupabaseClient,
  rows: ImportCommitTrackingRow[],
  batchId: string,
  userId: string,
  preexistingImportIds: ReadonlySet<string>,
): Promise<void> {
  const newRows = rows.filter((row) => !preexistingImportIds.has(row.plaid_transaction_id));
  if (newRows.length === 0) return;
  const committedRowsResults = await Promise.all(chunks(newRows.map((row) => row.plaid_transaction_id)).map(async (chunk) => {
    const table = service.from("transactions");
    if (typeof (table as unknown as { select?: unknown }).select !== "function") return [] as Array<{ id: string; plaid_transaction_id: string }>;
    const { data: committedRows, error } = await table
      .select("id,plaid_transaction_id")
      .eq("user_id", userId)
      .in("plaid_transaction_id", chunk);
    if (error) throw error;
    return (committedRows ?? []) as Array<{ id: string; plaid_transaction_id: string }>;
  }));
  const transactionIdByImportId = new Map(committedRowsResults.flat().map((row) => [row.plaid_transaction_id, row.id]));
  const { error } = await service.rpc("record_import_commit_transactions", {
    p_user_id: userId,
    p_batch_id: batchId,
    p_rows: newRows.map((row) => ({ row_id: row.rowId, transaction_id: transactionIdByImportId.get(row.plaid_transaction_id) })),
  });
  if (error) throw error;
}
