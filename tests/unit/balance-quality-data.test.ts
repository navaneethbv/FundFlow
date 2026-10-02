import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientStub } from "../fixtures/supabase-query";
import {
  loadBalanceReviews,
  reviewDailyBalanceQuality,
} from "@/lib/balance-quality-data";
const context = {
  id: "snapshot",
  observedAt: "2026-10-01T12:00:00Z",
  anchorId: "prior",
  current: {
    date: "2026-10-01",
    balance: 5000,
    currency: "USD",
    holdings: null,
  },
  previous: {
    date: "2026-09-30",
    balance: 1000,
    currency: "USD",
    holdings: null,
  },
};
beforeEach(() => vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "balanceQualityReview"));
afterEach(() => vi.unstubAllEnvs());
describe("balance quality persistence", () => {
  it("does no work with the flag off", async () => {
    vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "");
    const db = clientStub();
    await reviewDailyBalanceQuality(
      db as unknown as SupabaseClient,
      "owner",
      "2026-10-01",
    );
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("records owner-scoped frozen observations and derived reasons", async () => {
    const db = clientStub({ balance_quality_context: { data: [context] } });
    await reviewDailyBalanceQuality(
      db as unknown as SupabaseClient,
      "owner",
      "2026-10-01",
    );
    expect(db.callsOnRpc("balance_quality_context")).toEqual([
      [{ p_user_id: "owner", p_date: "2026-10-01" }],
    ]);
    expect(db.callsOnRpc("record_balance_quality_review")).toEqual([
      [
        {
          p_user_id: "owner",
          p_snapshot_id: "snapshot",
          p_observed_at: context.observedAt,
          p_anchor_id: "prior",
          p_reasons: ["balance_jump"],
        },
      ],
    ]);
  });
  it.each(["balance_quality_context", "record_balance_quality_review"])(
    "propagates a failed %s so cron records incomplete review processing",
    async (name) => {
      const failure = { message: "failure" };
      const db = clientStub({
        balance_quality_context: { data: [context] },
        [name]: { data: [context], error: failure },
      });
      await expect(
        reviewDailyBalanceQuality(
          db as unknown as SupabaseClient,
          "owner",
          "2026-10-01",
        ),
      ).rejects.toEqual(failure);
    },
  );
  it("handles no daily observations", async () => {
    const db = clientStub();
    await reviewDailyBalanceQuality(
      db as unknown as SupabaseClient,
      "owner",
      "2026-10-01",
    );
    expect(db.callsOnRpc("record_balance_quality_review")).toEqual([]);
  });
  it("reads only the owner with a bounded cursor and exposes the next page", async () => {
    const db = clientStub({
      balance_quality_reviews: {
        data: Array.from({ length: 26 }, (_, i) => ({ id: `review-${i}` })),
      },
    });
    const result = await loadBalanceReviews(
      db as unknown as SupabaseClient,
      "owner",
      "cursor",
    );
    expect(result.reviews).toHaveLength(25);
    expect(result.next).toBe("review-24");
    expect(db.scopedToUser("balance_quality_reviews", "owner")).toBe(true);
    expect(db.callsOn("balance_quality_reviews")).toContainEqual({
      method: "lt",
      args: ["id", "cursor"],
    });
  });
  it("handles empty queues and query failures", async () => {
    expect(
      await loadBalanceReviews(
        clientStub() as unknown as SupabaseClient,
        "owner",
      ),
    ).toEqual({ reviews: [], next: null });
    const error = { message: "denied" };
    await expect(
      loadBalanceReviews(
        clientStub({
          balance_quality_reviews: { error },
        }) as unknown as SupabaseClient,
        "owner",
      ),
    ).rejects.toEqual(error);
  });
});
