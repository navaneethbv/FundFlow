import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientStub } from "../fixtures/supabase-query";
const mock = vi.hoisted(() => ({ observability: vi.fn() }));
vi.mock("@/lib/sync-health", async (original) => ({
  ...(await original<object>()),
  loadInstitutionObservability: mock.observability,
}));
import { loadConnectionHealth } from "@/lib/connection-health-data";
const cast = (db: ReturnType<typeof clientStub>) =>
  db as unknown as SupabaseClient;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "connectionHealth,balanceQualityReview");
  mock.observability.mockResolvedValue({
    reconciliations: [],
    institutions: [],
  });
});
afterEach(() => vi.unstubAllEnvs());
it("does not query with the connection flag off", async () => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "");
  const db = clientStub();
  expect(await loadConnectionHealth(cast(db), "owner")).toBeNull();
  expect(db.from).not.toHaveBeenCalled();
});
it("does not read an unavailable review table when its flag is off", async () => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "connectionHealth");
  const db = clientStub();
  expect(await loadConnectionHealth(cast(db), "owner")).toEqual({
    rows: [],
    manualAccounts: 0,
  });
  expect(db.from).not.toHaveBeenCalledWith("balance_quality_reviews");
});
it("groups accounts and pending reviews by stable ids, preserving manual counts", async () => {
  const db = clientStub({
    plaid_items: {
      data: [{ id: "item", institution_name: "Bank", status: "active" }],
    },
    balance_quality_reviews: {
      data: [
        { id: "r1", account_id: "a" },
        { id: "r2", account_id: "unrelated" },
      ],
    },
    manual_accounts: { count: 2 },
  });
  mock.observability.mockResolvedValue({
    reconciliations: [{ plaidItemId: "item", accountId: "a" }],
    institutions: [
      {
        plaidItemId: "item",
        cursor: null,
        transactions: { state: "fresh" },
        investments: { state: "unavailable" },
      },
    ],
  });
  expect(await loadConnectionHealth(cast(db), "owner")).toMatchObject({
    rows: [
      {
        id: "item",
        linkedAccounts: 1,
        pendingReviews: 1,
        state: "account_review",
      },
    ],
    manualAccounts: 2,
  });
  for (const table of [
    "plaid_items",
    "balance_quality_reviews",
    "manual_accounts",
  ])
    expect(db.scopedToUser(table, "owner")).toBe(true);
});
it("reads beyond a provider page without silently losing pending reviews", async () => {
  const db = clientStub({
    balance_quality_reviews: {
      data: Array.from({ length: 501 }, (_, index) => ({
        id: index,
        account_id: "a",
      })),
    },
  });
  await loadConnectionHealth(cast(db), "owner");
  expect(db.callsOn("balance_quality_reviews")).toContainEqual({
    method: "range",
    args: [500, 999],
  });
});
it.each(["plaid_items", "balance_quality_reviews", "manual_accounts"])(
  "propagates unavailable %s",
  async (table) => {
    await expect(
      loadConnectionHealth(
        cast(clientStub({ [table]: { error: "failure" } })),
        "owner",
      ),
    ).rejects.toBe("failure");
  },
);
