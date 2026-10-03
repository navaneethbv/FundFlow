import type { BalanceReview } from "@/lib/balance-quality-data";
import type { AccountBalanceSnapshot } from "@/lib/accounts-page";
export interface ReviewableSnapshot extends AccountBalanceSnapshot {
  id?: string;
  observedAt?: string;
}
/** A decision applies to its exact raw observation, never to a later resync. */
export function applyBalanceReviewHistory(
  snapshots: ReviewableSnapshot[],
  reviews: BalanceReview[],
): ReviewableSnapshot[] {
  const decisions = new Map(
    reviews
      .filter(
        (review) =>
          review.decision === "carried" && review.superseded_at === null,
      )
      .map((review) => [
        `${review.account_id}:${review.snapshot_date}`,
        review,
      ]),
  );
  return snapshots.map((snapshot) => {
    const review = decisions.get(
      `${snapshot.accountId}:${snapshot.snapshotDate}`,
    );
    if (
      review?.anchor_balance == null ||
      review.raw_balance !== snapshot.currentBalance ||
      review.currency !== snapshot.currency ||
      Date.parse(review.observed_at) !== Date.parse(snapshot.observedAt ?? "")
    )
      return snapshot;
    return {
      ...snapshot,
      currentBalance: review.anchor_balance,
      provenance: "estimated",
      historyLabel: `Stale: carried from ${review.anchor_date}`,
    };
  });
}
