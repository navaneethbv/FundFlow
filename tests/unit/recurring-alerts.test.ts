import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidItemRow } from "@/lib/types";
import { normalizeRecurringMerchant, recurringIdentityKey } from "@/lib/recurring-detection";

const mockRecurringGet = vi.fn();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({ transactionsRecurringGet: mockRecurringGet }),
}));

vi.mock("@/lib/plaid-service", () => ({
  decryptItemToken: () => "access-token",
  listActiveItems: vi.fn(),
}));

const mockCreateNotification = vi.fn();
vi.mock("@/lib/notifications", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

// from("recurring_streams").select(...).eq(...).eq(...) resolves the existing
// rows; .upsert(...).select(...) resolves the write and its id/stream_id
// echo. Account resolution and the transaction-join table are exercised
// elsewhere (tests/unit/recurring-lib.test.ts) — this file only cares about
// the price-hike/new-subscription notification diff, so those tables just
// resolve to harmless empty results.
let existingRows: Array<{ stream_id: string; last_amount: number | null }>;
let existingInferredRows: Array<{ identity_key: string | null }> = [];
const mockUpsert = vi.fn();
const mockRpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => {
      switch (table) {
        case "recurring_streams":
          {
            const plaidResponse = Promise.resolve({ data: existingRows, error: null });
            Object.assign(plaidResponse, { eq: () => plaidResponse });
            const inferredResponse = Promise.resolve({ data: existingInferredRows, error: null });
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  // The real query branches on the "source" filter value: the
                  // plaid existing-streams read stops at this eq(); the
                  // inferred-identity read chains one more eq("is_active").
                  eq: (_column: string, value: string) =>
                    value === "inferred" ? { eq: () => inferredResponse } : plaidResponse,
                }),
              }),
            }),
            upsert: mockUpsert,
            update: () => ({
              eq: () => ({
                eq: () => ({ in: () => Promise.resolve({ error: null }) }),
              }),
            }),
          };
          }
        case "accounts":
          return {
            select: () => ({
              eq: () => ({
                eq: () => Promise.resolve({
                  data: [{ id: "local-acct-1", plaid_account_id: "plaid-acct-1" }],
                  error: null,
                }),
              }),
            }),
          };
        case "transactions":
          return {
            select: () => ({
              eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
            }),
          };
        case "recurring_stream_transactions":
          return {
            delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
            insert: () => Promise.resolve({ error: null }),
          };
        default:
          throw new Error(`Unexpected table ${table}`);
      }
    },
  }),
}));

import { refreshRecurringForItem } from "@/lib/recurring";

const item = {
  id: "item-db-1",
  user_id: "user-1",
} as PlaidItemRow;

function outflow(streamId: string, merchant: string, lastAmount: number, accountId = "plaid-acct-1") {
  return {
    stream_id: streamId,
    description: merchant,
    merchant_name: merchant,
    average_amount: { amount: lastAmount },
    last_amount: { amount: lastAmount },
    frequency: "MONTHLY",
    status: "MATURE",
    personal_finance_category: { primary: "ENTERTAINMENT" },
    is_active: true,
    account_id: accountId,
    transaction_ids: [],
  };
}

/** The same identity_key mapStreamRow computes for one of these outflow streams. */
function outflowIdentity(merchant: string, accountId = "local-acct-1") {
  return recurringIdentityKey(
    "user-1",
    accountId,
    "outflow",
    normalizeRecurringMerchant(merchant),
    "MONTHLY",
  );
}

describe("recurring stream alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockReturnValue({
      select: () => Promise.resolve({ data: [], error: null }),
    });
    mockRpc.mockImplementation((_name: string, args: { p_payload: { streams: unknown[] } }) => Promise.resolve({ data: { plaid: args.p_payload.streams.length }, error: null }));
    existingRows = [
      { stream_id: "s1", last_amount: 15.49 },
      { stream_id: "s2", last_amount: 9.99 },
    ];
    existingInferredRows = [];
  });

  it("notifies on a price hike and on a new subscription", async () => {
    mockRecurringGet.mockResolvedValue({
      data: {
        inflow_streams: [],
        outflow_streams: [
          outflow("s1", "Netflix", 17.99),
          outflow("s2", "Hulu", 9.99),
          outflow("s9", "Peacock", 7.99),
        ],
      },
    });

    await refreshRecurringForItem(item);

    expect(mockRpc).toHaveBeenCalled();
    const calls = mockCreateNotification.mock.calls;
    const types = calls.map((call) => call[1]);
    expect(types).toContain("price_hike");
    expect(types).toContain("new_subscription");

    const hike = calls.find((call) => call[1] === "price_hike")!;
    expect(hike[0]).toBe("user-1");
    expect(hike[2].title).toContain("Netflix");
    expect(hike[2].body).toContain("$15.49");
    expect(hike[2].body).toContain("$17.99");
    expect(hike[3]).toBe("Netflix");

    const fresh = calls.find((call) => call[1] === "new_subscription")!;
    expect(fresh[2].title).toContain("Peacock");
  });

  it("stays silent on the first refresh so seeding never spams", async () => {
    existingRows = [];
    mockRecurringGet.mockResolvedValue({
      data: {
        inflow_streams: [],
        outflow_streams: [outflow("s1", "Netflix", 15.49)],
      },
    });

    await refreshRecurringForItem(item);

    expect(mockRpc).toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("dedupes two price hikes that share one merchant identity", async () => {
    // Plaid gave the same merchant/account/cadence two separate stream ids;
    // both existed before at a lower amount and both increased, but they
    // resolve to one identity and must only notify once.
    existingRows = [
      { stream_id: "s1a", last_amount: 15.49 },
      { stream_id: "s1b", last_amount: 15.49 },
    ];
    mockRecurringGet.mockResolvedValue({
      data: {
        inflow_streams: [],
        outflow_streams: [
          outflow("s1a", "Netflix", 17.99),
          outflow("s1b", "Netflix", 17.99),
        ],
      },
    });

    await refreshRecurringForItem(item);

    const hikes = mockCreateNotification.mock.calls.filter((call) => call[1] === "price_hike");
    expect(hikes).toHaveLength(1);
  });

  it("dedupes two new subscriptions that share one merchant identity", async () => {
    // Diff only runs once history exists (first-refresh seeding stays
    // silent), so this needs at least one unrelated prior stream.
    existingRows = [{ stream_id: "unrelated", last_amount: 5 }];
    mockRecurringGet.mockResolvedValue({
      data: {
        inflow_streams: [],
        outflow_streams: [
          outflow("s9a", "Peacock", 7.99),
          outflow("s9b", "Peacock", 7.99),
        ],
      },
    });

    await refreshRecurringForItem(item);

    const fresh = mockCreateNotification.mock.calls.filter((call) => call[1] === "new_subscription");
    expect(fresh).toHaveLength(1);
  });

  it("suppresses a new-subscription notification whose identity already exists as an inferred stream", async () => {
    existingRows = [{ stream_id: "unrelated", last_amount: 5 }];
    existingInferredRows = [{ identity_key: outflowIdentity("Peacock") }];
    mockRecurringGet.mockResolvedValue({
      data: {
        inflow_streams: [],
        outflow_streams: [outflow("s9", "Peacock", 7.99)],
      },
    });

    await refreshRecurringForItem(item);

    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("never lets a notification failure break the refresh", async () => {
    mockCreateNotification.mockRejectedValue(new Error("smtp down"));
    mockRecurringGet.mockResolvedValue({
      data: {
        inflow_streams: [],
        outflow_streams: [outflow("s1", "Netflix", 17.99)],
      },
    });

    await expect(refreshRecurringForItem(item)).resolves.toBe(1);
  });
});
