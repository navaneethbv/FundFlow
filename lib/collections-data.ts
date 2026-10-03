import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IN_FILTER_CHUNK_SIZE } from "@/lib/postgrest-limits";
import {
  buildCollections,
  COLLECTION_TAG_PREFIX,
  type CollectionAnnotation,
  type CollectionBudget,
  type CollectionSummary,
  type CollectionTransaction,
} from "@/lib/collections";

/** Annotations scanned for collection tags; far above a personal ledger's tagged rows. */
const MAX_TAGGED_ANNOTATIONS = 5000;

/** Cookie-bound, owner-only reads, including when household rows are visible. */
export async function loadCollections(client: SupabaseClient, userId: string): Promise<CollectionSummary[]> {
  const [annotationResult, budgetResult] = await Promise.all([
    client.from("transaction_annotations").select("transaction_id, tags")
      .eq("user_id", userId).not("tags", "is", null).limit(MAX_TAGGED_ANNOTATIONS),
    client.from("transaction_collections").select("name, budget").eq("user_id", userId).limit(500),
  ]);
  if (annotationResult.error) throw annotationResult.error;
  if (budgetResult.error) throw budgetResult.error;
  const annotations = ((annotationResult.data ?? []) as CollectionAnnotation[])
    .filter((row) => (row.tags ?? []).some((tag) => tag.startsWith(COLLECTION_TAG_PREFIX)));
  const ids = annotations.map((row) => row.transaction_id);
  const chunks = Array.from({ length: Math.ceil(ids.length / IN_FILTER_CHUNK_SIZE) }, (_, index) =>
    ids.slice(index * IN_FILTER_CHUNK_SIZE, (index + 1) * IN_FILTER_CHUNK_SIZE));
  const results = await Promise.all(chunks.map((chunk) =>
    client.from("transactions").select("id, date, amount, pfc_primary").eq("user_id", userId).in("id", chunk)));
  const transactions: CollectionTransaction[] = [];
  for (const result of results) {
    if (result.error) throw result.error;
    transactions.push(...((result.data ?? []) as CollectionTransaction[]));
  }
  return buildCollections(annotations, transactions, (budgetResult.data ?? []) as CollectionBudget[]);
}
