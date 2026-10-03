import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  loadInstitutionObservability,
  SYNC_HEALTH_ITEM_COLUMNS,
} from "@/lib/sync-health";
import {
  summarizeConnection,
  type ConnectionItem,
} from "@/lib/connection-health";

/** Cookie client required. Pages keep growing until the owner-scoped read ends. */
async function readOwnerRows(
  client: SupabaseClient,
  userId: string,
  table: "plaid_items" | "balance_quality_reviews",
  select: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = client
      .from(table)
      .select(select)
      .eq("user_id", userId)
      .order("id")
      .range(offset, offset + 499);
    if (table === "balance_quality_reviews")
      query = query.eq("decision", "pending").is("superseded_at", null);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
export async function loadConnectionHealth(
  client: SupabaseClient,
  userId: string,
) {
  if (!isFeatureEnabled("connectionHealth")) return null;
  const items = (await readOwnerRows(
    client,
    userId,
    "plaid_items",
    SYNC_HEALTH_ITEM_COLUMNS,
  )) as unknown as ConnectionItem[];
  const [observability, reviews, manual] = await Promise.all([
    loadInstitutionObservability(client, userId, items),
    isFeatureEnabled("balanceQualityReview")
      ? readOwnerRows(
          client,
          userId,
          "balance_quality_reviews",
          "id,account_id",
        )
      : Promise.resolve([]),
    client
      .from("manual_accounts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);
  if (manual.error) throw manual.error;
  const accountsByItem = new Map<string, Set<string>>();
  for (const account of observability.reconciliations) {
    const ids = accountsByItem.get(account.plaidItemId) ?? new Set<string>();
    ids.add(account.accountId);
    accountsByItem.set(account.plaidItemId, ids);
  }
  const healthById = new Map(
    observability.institutions.map((health) => [health.plaidItemId, health]),
  );
  const rows = items.map((item) => {
    const ids = accountsByItem.get(item.id) ?? new Set<string>();
    return summarizeConnection(
      item,
      healthById.get(item.id)!,
      ids.size,
      reviews.filter((review) => ids.has(String(review.account_id))).length,
    );
  });
  return { rows, manualAccounts: manual.count ?? 0 };
}
