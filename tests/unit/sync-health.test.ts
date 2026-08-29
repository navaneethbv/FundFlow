import { describe, expect, it } from "vitest";
import { deriveProductSyncHealth } from "@/lib/sync-health";

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
