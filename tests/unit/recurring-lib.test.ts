import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTransactionsRecurringGet = vi.fn();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    transactionsRecurringGet: (...args: unknown[]) => mockTransactionsRecurringGet(...args),
  }),
}));

const mockServiceClient = {
  from: vi.fn(),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockDecryptItemToken = vi.fn().mockReturnValue("access-token-123");
const mockListActiveItems = vi.fn();
vi.mock("@/lib/plaid-service", () => ({
  decryptItemToken: (...args: unknown[]) => mockDecryptItemToken(...args),
  listActiveItems: (...args: unknown[]) => mockListActiveItems(...args),
}));

const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/notifications", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { refreshRecurringForItem, refreshRecurringForUser } from "@/lib/recurring";
import type { PlaidItemRow } from "@/lib/types";

describe("lib/recurring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const dummyItem: PlaidItemRow = {
    id: "item-db-1",
    user_id: "user-1",
    plaid_item_id: "plaid-item-1",
    institution_id: "inst-1",
    institution_name: "Test Bank",
    access_token_ciphertext: "cipher",
    access_token_iv: "iv",
    access_token_tag: "tag",
    sync_cursor: "cursor-1",
    status: "active",
    error_code: null,
  };

  it("refreshRecurringForItem returns 0 if response contains no streams", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [],
      },
    });

    const count = await refreshRecurringForItem(dummyItem);
    expect(count).toBe(0);
    expect(mockServiceClient.from).not.toHaveBeenCalled();
  });

  it("refreshRecurringForItem fetches streams, upserts rows, and notifies diff changes", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            merchant_name: "Netflix",
            description: "Netflix Subscription",
            average_amount: { amount: 15.99 },
            last_amount: { amount: 19.99 }, // price hike
            frequency: "MONTHLY",
            status: "MATURE",
            personal_finance_category: { primary: "ENTERTAINMENT" },
            is_active: true,
          },
        ],
      },
    });

    // Mock DB reads and upsert
    const eqItem = vi.fn().mockResolvedValue({
      data: [
        {
          stream_id: "stream-1",
          last_amount: 15.99, // prior amount
        },
      ],
      error: null,
    });
    const eqUser = vi.fn().mockReturnValue({ eq: eqItem });
    const select = vi.fn().mockReturnValue({ eq: eqUser });

    const upsert = vi.fn().mockResolvedValue({ error: null });

    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "recurring_streams") {
        return { select, upsert };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const count = await refreshRecurringForItem(dummyItem);

    expect(count).toBe(1);
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: "user-1",
          stream_id: "stream-1",
          last_amount: 19.99,
        }),
      ],
      { onConflict: "stream_id" },
    );
    expect(mockCreateNotification).toHaveBeenCalledWith(
      "user-1",
      "price_hike",
      expect.objectContaining({
        title: "Price increase: Netflix",
      }),
      "Netflix",
    );
  });

  it("refreshRecurringForUser iterates active items and returns total stream count", async () => {
    mockListActiveItems.mockResolvedValue([dummyItem]);
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            description: "Spotify",
            last_amount: { amount: 9.99 },
          },
        ],
      },
    });

    const eqItem = vi.fn().mockResolvedValue({ data: [], error: null });
    const eqUser = vi.fn().mockReturnValue({ eq: eqItem });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    const upsert = vi.fn().mockResolvedValue({ error: null });

    mockServiceClient.from.mockReturnValue({ select, upsert });

    const total = await refreshRecurringForUser("user-1");
    expect(total).toBe(1);
  });

  it("refreshRecurringForUser isolates errors per item and logs error", async () => {
    mockListActiveItems.mockResolvedValue([dummyItem]);
    mockTransactionsRecurringGet.mockRejectedValueOnce(new Error("API Error"));

    const total = await refreshRecurringForUser("user-1");
    expect(total).toBe(0);
    expect(mockLogError).toHaveBeenCalledWith("recurring.item", expect.any(Error));
  });
});
