import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCanonicalProjection } from "@/lib/finance-query";
import {
  buildCollections,
  type CollectionAnnotation,
  type CollectionBudget,
  type CollectionSummary,
  type CollectionTransaction,
} from "@/lib/collections";

/** Annotations scanned for collection tags; far above a personal ledger's tagged rows. */
const MAX_TAGGED_ANNOTATIONS = 5000;

async function collectionAnnotations(client: SupabaseClient, userId: string): Promise<CollectionAnnotation[]> {
  const rows: CollectionAnnotation[] = [];
  for (let offset = 0; offset <= MAX_TAGGED_ANNOTATIONS; offset += 1000) {
    const { data, error } = await client.from("transaction_annotations").select("transaction_id,tags")
      .eq("user_id", userId).not("tags", "is", null).order("transaction_id").range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data ?? []) as CollectionAnnotation[]);
    if (rows.length > MAX_TAGGED_ANNOTATIONS) throw new Error("Collection annotation limit exceeded");
    if ((data?.length ?? 0) < 1000) return rows;
  }
  throw new Error("Collection annotation limit exceeded");
}

/** Cookie-bound, owner-only reads, including when household rows are visible. */
export async function loadCollections(client: SupabaseClient, userId: string): Promise<CollectionSummary[]> {
  const [annotations, budgetResult, projection] = await Promise.all([
    collectionAnnotations(client, userId),
    client.from("transaction_collections").select("name, budget").eq("user_id", userId).limit(501),
    loadCanonicalProjection(client, { scope: { kind: "mine", ownerUserId: userId }, maxRows: 50000 }),
  ]);
  if (budgetResult.error) throw budgetResult.error;
  if (projection.truncated || (budgetResult.data?.length ?? 0) > 500) throw new Error("Collection data limit exceeded");
  const transactions = new Map<string, CollectionTransaction>();
  const taggedIds = new Set(annotations.filter((row) => row.tags?.some((tag) => tag.startsWith("collection:"))).map((row) => row.transaction_id));
  for (const row of projection.transactions) {
    if (!taggedIds.has(row.sourceTransactionId)) continue;
    const currency = row.accountId ? projection.currencyByAccountId.get(row.accountId) : "USD";
    if (currency !== "USD") throw new Error("Collections currently require USD transactions");
    const existing = transactions.get(row.sourceTransactionId);
    const spent = row.flow === "expense" ? row.signedAmount : 0;
    transactions.set(row.sourceTransactionId, { id: row.sourceTransactionId, date: row.date,
      amount: Number(existing?.amount ?? 0) + spent, pfc_primary: null });
  }
  return buildCollections(annotations, [...transactions.values()], (budgetResult.data ?? []) as CollectionBudget[]);
}
