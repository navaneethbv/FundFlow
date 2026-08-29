import { describe, expect, it } from "vitest";
import {
  deriveProductSyncHealth,
  loadInstitutionObservability,
} from "@/lib/sync-health";
import { clientStub } from "../fixtures/supabase-query";

const NOW = new Date("2026-08-29T12:00:00.000Z");

function job(
  status: "pending" | "running" | "done" | "failed",
  updatedAt: string,
  lastError: string | null = null,
) {
  return { status, updated_at: updatedAt, last_error: lastError };
}

describe("deriveProductSyncHealth", () => {
  it("reports never_synced when no attempt exists", () => {
    expect(
      deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: null,
        latestSuccessfulJob: null,
        now: NOW,
      }),
    ).toEqual({
      state: "never_synced",
      lastSuccessAt: null,
      lastAttemptAt: null,
      safeErrorCode: null,
    });
  });

  it("reports healthy and stale from the latest successful completion", () => {
    expect(
      deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: job("done", "2026-08-29T11:00:00.000Z"),
        latestSuccessfulJob: job("done", "2026-08-29T11:00:00.000Z"),
        now: NOW,
      }).state,
    ).toBe("healthy");
    expect(
      deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: job("done", "2026-08-26T11:00:00.000Z"),
        latestSuccessfulJob: job("done", "2026-08-26T11:00:00.000Z"),
        now: NOW,
      }).state,
    ).toBe("stale");
  });

  it.each([
    ["RATE_LIMIT_EXCEEDED", "rate_limited"],
    ["PRODUCTS_NOT_SUPPORTED", "product_unavailable"],
    ["ITEM_LOGIN_REQUIRED", "repair_required"],
    ["rate_limited", "rate_limited"],
    ["no_investment_product", "product_unavailable"],
    ["product_not_ready", "repair_required"],
  ] as const)("maps safe provider code %s to %s", (code, state) => {
    expect(
      deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: job("failed", "2026-08-29T11:00:00.000Z", code),
        latestSuccessfulJob: null,
        now: NOW,
      }),
    ).toMatchObject({ state, safeErrorCode: code });
  });

  it("does not expose arbitrary stored error text", () => {
    expect(
      deriveProductSyncHealth({
        itemStatus: "error",
        itemErrorCode: "token=secret customer@example.com",
        latestJob: job("failed", "2026-08-29T11:00:00.000Z", "raw provider payload"),
        latestSuccessfulJob: null,
        now: NOW,
      }),
    ).toMatchObject({ state: "repair_required", safeErrorCode: null });
  });
});

describe("loadInstitutionObservability", () => {
  it("scopes every source query to the authenticated user", async () => {
    const supabase = clientStub({
      accounts: { data: [] },
      sync_jobs: { data: null },
    });

    const result = await loadInstitutionObservability(
      supabase as never,
      "user-1",
      [
        {
          id: "item-1",
          institution_name: "Test Bank",
          status: "active",
          error_code: null,
        },
      ],
      NOW,
    );

    expect(result.institutions[0]).toMatchObject({
      plaidItemId: "item-1",
      transactions: { state: "never_synced" },
      investments: { state: "never_synced" },
    });
    expect(supabase.scopedToUser("accounts", "user-1")).toBe(true);
    expect(supabase.scopedToUser("sync_jobs", "user-1")).toBe(true);
  });
});
