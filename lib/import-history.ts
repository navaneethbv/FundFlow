import type { SupabaseClient } from "@supabase/supabase-js";

export interface ImportHistorySummary {
  imported: number;
  skipped: number;
  flagged: number | null;
  targets: { account_id?: string; manual_account_id?: string; name: string }[];
  unknownTargets: number;
  committedAt: string;
  committedBy: string;
}
export interface ImportHistoryBatch {
  id: string;
  file_name: string;
  status?: "committed" | "discarded";
  created_at: string;
  history_profile_name: string | null;
  history_summary: ImportHistorySummary | null;
  undoAvailable?: boolean;
}
export const IMPORT_HISTORY_PAGE_SIZE = 25;

export function importHistoryPage(value: string | undefined): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 10000 ? page : 1;
}

/** Cookie-bound, owner-only reads, including when household rows are visible. */
export async function loadImportHistory(
  supabase: SupabaseClient,
  userId: string,
  page: number,
  undoEnabled = false,
) {
  const offset = (page - 1) * IMPORT_HISTORY_PAGE_SIZE;
  let query = supabase.from("import_review_batches")
    .select("id, file_name, status, created_at, history_profile_name, history_summary")
    .eq("user_id", userId);
  if (!undoEnabled || typeof (query as unknown as { in?: unknown }).in !== "function") {
    query = query.eq("status", "committed");
  } else {
    query = query.in("status", ["committed", "discarded"]);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + IMPORT_HISTORY_PAGE_SIZE);
  if (error) throw error;
  const rows = (data ?? []) as ImportHistoryBatch[];
  if (undoEnabled && rows.length > 0) {
    const availability = await Promise.all(rows.map(async (batch) => {
      if (batch.status !== "committed") return [batch.id, false] as const;
      const { data: committedRows, error: rowError } = await supabase
        .from("import_review_rows")
        .select("id,committed_transaction_id")
        .eq("user_id", userId)
        .eq("batch_id", batch.id)
        .eq("status", "committed");
      if (rowError) throw rowError;
      const values = committedRows ?? [];
      return [
        batch.id,
        values.length > 0 && values.every((row) => typeof row.committed_transaction_id === "string"),
      ] as const;
    }));
    const availabilityById = new Map(availability);
    for (const batch of rows) batch.undoAvailable = availabilityById.get(batch.id) === true;
  }
  return { batches: rows.slice(0, IMPORT_HISTORY_PAGE_SIZE), hasNext: rows.length > IMPORT_HISTORY_PAGE_SIZE };
}
