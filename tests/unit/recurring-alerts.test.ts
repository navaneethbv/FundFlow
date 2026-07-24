import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidItemRow } from "@/lib/types";

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
// rows; .upsert(...) resolves the write. Both hang off the same from() mock.
let existingRows: Array<{ stream_id: string; last_amount: number | null }>;
const mockUpsert = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: existingRows, error: null }),
        }),
      }),
      upsert: mockUpsert,
    }),
  }),
}));

import { refreshRecurringForItem } from "@/lib/recurring";

const item = {
  id: "item-db-1",
  user_id: "user-1",
} as PlaidItemRow;

function outflow(streamId: string, merchant: string, lastAmount: number) {
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
  };
}

describe("recurring stream alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
    existingRows = [
      { stream_id: "s1", last_amount: 15.49 },
      { stream_id: "s2", last_amount: 9.99 },
    ];
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

    expect(mockUpsert).toHaveBeenCalled();
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

    expect(mockUpsert).toHaveBeenCalled();
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
