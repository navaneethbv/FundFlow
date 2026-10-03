import { describe, it, expect } from "vitest";
import {
  applyBalanceReviewHistory,
  type ReviewableSnapshot,
} from "@/lib/balance-quality-history";
import type { BalanceReview } from "@/lib/balance-quality-data";
const snapshot: ReviewableSnapshot = {
  id: "snapshot",
  accountId: "a",
  manualAccountId: null,
  snapshotDate: "2026-10-01",
  currentBalance: 8000,
  availableBalance: 7000,
  currency: "USD",
  observedAt: "2026-10-01T12:00:00.000Z",
};
const review: BalanceReview = {
  id: "r",
  account_id: "a",
  snapshot_date: "2026-10-01",
  observed_at: "2026-10-01T12:00:00+00:00",
  raw_balance: 8000,
  anchor_balance: 2000,
  anchor_date: "2026-09-30",
  currency: "USD",
  reasons: ["balance_jump"],
  decision: "carried",
  version: "v",
  decided_at: "2026-10-01T12:01:00Z",
  superseded_at: null,
};
describe("carried history", () => {
  it("labels a matching value stale without mutating the raw observation", () => {
    expect(applyBalanceReviewHistory([snapshot], [review])[0]).toMatchObject({
      currentBalance: 2000,
      historyLabel: "Stale: carried from 2026-09-30",
    });
    expect(snapshot.currentBalance).toBe(8000);
  });
  it.each([
    { decision: "pending" },
    { decision: "accepted" },
    { superseded_at: "2026-10-01" },
    { account_id: "other" },
    { snapshot_date: "2026-09-30" },
    { raw_balance: 9000 },
    { currency: "EUR" },
    { observed_at: "2026-10-01T13:00:00Z" },
    { anchor_balance: null },
  ])("rejects an inapplicable decision %j", (patch) => {
    expect(
      applyBalanceReviewHistory(
        [snapshot],
        [{ ...review, ...patch } as BalanceReview],
      ),
    ).toEqual([snapshot]);
  });
  it("never applies a review when the capture time is missing", () => {
    const raw = { ...snapshot, observedAt: undefined };
    expect(applyBalanceReviewHistory([raw], [review])).toEqual([raw]);
  });
});
