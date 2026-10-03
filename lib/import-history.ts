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
  created_at: string;
  history_profile_name: string | null;
  history_summary: ImportHistorySummary | null;
}
export const IMPORT_HISTORY_PAGE_SIZE = 25;

export function importHistoryPage(value: string | undefined): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 10000 ? page : 1;
}

/** Cookie-bound, owner-only reads, including when household rows are visible. */
export async function loadImportHistory(supabase: SupabaseClient, userId: string, page: number) {
  const offset = (page - 1) * IMPORT_HISTORY_PAGE_SIZE;
  const { data, error } = await supabase.from("import_review_batches")
    .select("id, file_name, created_at, history_profile_name, history_summary")
    .eq("user_id", userId).eq("status", "committed")
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + IMPORT_HISTORY_PAGE_SIZE);
  if (error) throw error;
  const rows = (data ?? []) as ImportHistoryBatch[];
  return { batches: rows.slice(0, IMPORT_HISTORY_PAGE_SIZE), hasNext: rows.length > IMPORT_HISTORY_PAGE_SIZE };
}
