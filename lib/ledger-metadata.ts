import type { SupabaseClient } from "@supabase/supabase-js";
import { collectLedgerChunks } from "@/lib/ledger-data";
import type { LedgerFilters } from "@/lib/ledger-query";
import type { LedgerProjectedRow } from "@/lib/ledger-projection";
import { annotationProjectionColumns, storedRuleActions, tagsWithRuleActions } from "@/lib/rule-actions";
import { runBatched } from "@/lib/finance-query";
import { chunkValues } from "@/lib/postgrest-limits";

type MetadataRow = { transaction_id: string; note?: string | null; tags?: string[] | null; cleared_at?: string | null };

export function needsLedgerMetadata(filters: LedgerFilters): boolean {
  return Boolean(filters.tag || filters.tagState || filters.note || filters.cleared || filters.receipt || filters.split);
}

/** Only IDs from the bounded owner scope enter these sequential, bounded reads. */
async function loadMetadata(reader: SupabaseClient, ownerId: string, ids: string[], table: string, columns: string): Promise<MetadataRow[]> {
  const rows: MetadataRow[] = [];
  await runBatched(chunkValues(ids).map((batch) => async () => {
    const loaded = await collectLedgerChunks<MetadataRow>(async (from, to) => {
      const result = await reader.from(table).select(columns, { count: "exact" }).eq("user_id", ownerId)
        .in("transaction_id", batch).order(table === "transaction_annotations" ? "transaction_id" : "id", { ascending: true }).range(from, to);
      if (!result.error && (!Array.isArray(result.data) || result.count == null)) throw new Error("ledger_metadata_incomplete");
      return { rows: (result.data ?? []) as unknown as MetadataRow[], error: result.error, count: result.count };
    }, 1000, 20_000 - rows.length);
    rows.push(...loaded);
  }), 1);
  return rows;
}

/** A failed or truncated metadata read throws; absence is meaningful only after a complete read. */
export async function filterLedgerMetadata<T extends LedgerProjectedRow>(reader: SupabaseClient, ownerId: string, rows: T[], filters: LedgerFilters): Promise<T[]> {
  if (!needsLedgerMetadata(filters) || rows.length === 0) return rows;
  const ids = rows.map(row => row.id);
  const annotations = filters.tag || filters.tagState || filters.note || filters.cleared
    ? await loadMetadata(reader, ownerId, ids, "transaction_annotations", annotationProjectionColumns("transaction_id,note,tags,cleared_at")) : [];
  const receipts = filters.receipt ? await loadMetadata(reader, ownerId, ids, "receipts", "id,transaction_id") : [];
  const splits = filters.split ? await loadMetadata(reader, ownerId, ids, "transaction_splits", "id,transaction_id") : [];
  const byId = new Map(annotations.map(row => [row.transaction_id, row]));
  const receiptIds = new Set(receipts.map(row => row.transaction_id));
  const splitIds = new Set(splits.map(row => row.transaction_id));
  const note = filters.note?.toLocaleLowerCase();
  return rows.filter(row => {
    const annotation = byId.get(row.id);
    const tags = tagsWithRuleActions(annotation?.tags ?? [], row.ruleActions ?? (annotation ? storedRuleActions(annotation) : undefined));
    if (filters.tag && !tags.includes(filters.tag)) return false;
    if (filters.tagState && (tags.length > 0) !== (filters.tagState === "tagged")) return false;
    if (note && !annotation?.note?.toLocaleLowerCase().includes(note)) return false;
    if (filters.cleared && Boolean(annotation?.cleared_at) !== (filters.cleared === "cleared")) return false;
    if (filters.receipt && receiptIds.has(row.id) !== (filters.receipt === "attached")) return false;
    if (filters.split && splitIds.has(row.id) !== (filters.split === "split")) return false;
    return true;
  });
}
