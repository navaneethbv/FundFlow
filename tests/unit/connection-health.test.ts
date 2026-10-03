import { describe, expect, it } from "vitest";
import { summarizeConnection } from "@/lib/connection-health";
import type { InstitutionSyncHealth } from "@/lib/sync-health";
const product = {
  state: "healthy" as const,
  lastSuccessAt: "2026-10-01T12:00:00Z",
  lastAttemptAt: null,
  safeErrorCode: null,
};
const health: InstitutionSyncHealth = {
  plaidItemId: "i",
  institutionName: "Bank",
  transactions: product,
  investments: { ...product, state: "product_unavailable" },
  accountsUpdatedAt: null,
  oldestTransactionDate: null,
  newestTransactionDate: null,
  cursor: null,
};
const item = {
  id: "i",
  institution_name: "Bank",
  status: "active",
  error_code: null,
};
describe("connection health recovery", () => {
  it("does not call an unsupported optional product a sync failure", () => {
    expect(summarizeConnection(item, health, 2, 0).state).toBe("healthy");
  });
  it.each([
    "ITEM_LOGIN_REQUIRED",
    "PENDING_EXPIRATION",
    "ADDITIONAL_CONSENT_REQUIRED",
    "TOKEN_ROTATION_LOST",
  ])("offers reconnect for %s ahead of account review", (error_code) => {
    expect(
      summarizeConnection({ ...item, error_code }, health, 2, 4).state,
    ).toBe("reconnect");
  });
  it("separates provider outages from authorization failures", () => {
    expect(
      summarizeConnection(
        { ...item, status: "error", error_code: "INSTITUTION_DOWN" },
        health,
        2,
        0,
      ).state,
    ).toBe("sync_error");
  });
  it.each([
    "stale",
    "repair_required",
    "rate_limited",
    "never_synced",
  ] as const)("offers repair for transaction state %s", (state) => {
    expect(
      summarizeConnection(
        item,
        { ...health, transactions: { ...product, state } },
        2,
        0,
      ).state,
    ).toBe("sync_error");
  });
  it("shows review counts and handles a connection with no persisted accounts", () => {
    expect(summarizeConnection(item, health, 2, 3)).toMatchObject({
      state: "account_review",
      linkedAccounts: 2,
      pendingReviews: 3,
    });
    expect(
      summarizeConnection({ ...item, institution_name: null }, health, 0, 0),
    ).toMatchObject({ name: "Bank", state: "account_review" });
  });
});
