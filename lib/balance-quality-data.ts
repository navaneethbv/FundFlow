import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  assessBalanceQuality,
  type QualityReading,
  type BalanceQualityReason,
} from "@/lib/balance-quality";

interface QualityContext {
  id: string;
  observedAt: string;
  anchorId: string | null;
  current: QualityReading;
  previous: QualityReading | null;
}
export interface BalanceReview {
  id: string;
  account_id: string;
  snapshot_date: string;
  observed_at: string;
  raw_balance: number | null;
  anchor_balance: number | null;
  anchor_date: string | null;
  currency: string;
  reasons: BalanceQualityReason[];
  decision: "pending" | "accepted" | "carried";
  version: string;
  decided_at: string | null;
  superseded_at: string | null;
}
export const BALANCE_REVIEW_COLUMNS =
  "id,account_id,snapshot_date,observed_at,raw_balance,anchor_balance,anchor_date,currency,reasons,decision,version,decided_at,superseded_at";

/** Background processing only; the snapshot writer owns this service client. */
export async function reviewDailyBalanceQuality(
  service: SupabaseClient,
  userId: string,
  date: string,
): Promise<void> {
  if (!isFeatureEnabled("balanceQualityReview")) return;
  const { data, error } = await service.rpc("balance_quality_context", {
    p_user_id: userId,
    p_date: date,
  });
  if (error) throw error;
  await Promise.all(
    ((data ?? []) as QualityContext[]).map(async (context) => {
      const { error: writeError } = await service.rpc(
        "record_balance_quality_review",
        {
          p_user_id: userId,
          p_snapshot_id: context.id,
          p_observed_at: context.observedAt,
          p_anchor_id: context.anchorId,
          p_reasons: assessBalanceQuality(context.current, context.previous),
        },
      );
      if (writeError) throw writeError;
    }),
  );
}

/** Cookie-bound reads only. Keyset pagination exposes all reviews without truncation. */
export async function loadBalanceReviews(
  client: SupabaseClient,
  userId: string,
  before?: string,
) {
  if (!isFeatureEnabled("balanceQualityReview"))
    return { reviews: [] as BalanceReview[], next: null };
  let query = client
    .from("balance_quality_reviews")
    .select(BALANCE_REVIEW_COLUMNS)
    .eq("user_id", userId)
    .order("id", { ascending: false })
    .limit(26);
  if (before) query = query.lt("id", before);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as BalanceReview[];
  return {
    reviews: rows.slice(0, 25),
    next: rows.length > 25 ? rows[24]!.id : null,
  };
}

/** Match a bounded chunk of visible snapshot ids; no household review expansion. */
export async function loadCarriedReviews(
  client: SupabaseClient,
  userId: string,
  snapshotIds: string[],
): Promise<BalanceReview[]> {
  if (!isFeatureEnabled("balanceQualityReview") || snapshotIds.length === 0)
    return [];
  const groups = Array.from(
    { length: Math.ceil(snapshotIds.length / 50) },
    (_, index) => snapshotIds.slice(index * 50, (index + 1) * 50),
  );
  const results = await Promise.all(
    groups.map(async (ids) => {
      const { data, error } = await client
        .from("balance_quality_reviews")
        .select(BALANCE_REVIEW_COLUMNS)
        .eq("user_id", userId)
        .eq("decision", "carried")
        .is("superseded_at", null)
        .in("snapshot_id", ids);
      if (error) throw error;
      return (data ?? []) as BalanceReview[];
    }),
  );
  return results.flat();
}
