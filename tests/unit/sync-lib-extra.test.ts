import { describe, it, expect, vi, beforeEach } from "vitest";

const mockListActiveItems = vi.fn();
const mockSetItemStatus = vi.fn();

vi.mock("@/lib/plaid-service", () => ({
  listActiveItems: (...args: unknown[]) => mockListActiveItems(...args),
  setItemStatus: (...args: unknown[]) => mockSetItemStatus(...args),
  decryptItemTokenAndUpgrade: vi.fn().mockResolvedValue("access-token"),
}));

const mockServiceClient = { from: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({ logError: (...args: unknown[]) => mockLogError(...args) }));

const mockInvalidateDashboardCache = vi.fn();
vi.mock("@/lib/dashboard-cache", () => ({
  invalidateDashboardCache: (...args: unknown[]) => mockInvalidateDashboardCache(...args),
}));

const mockCreateNotification = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/notifications", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

import { syncAllForUser } from "@/lib/sync";

describe("syncAllForUser error isolation & sync job tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles sync job record errors and bank error notifications gracefully", async () => {
    mockListActiveItems.mockResolvedValueOnce([
      {
        id: "item-1",
        user_id: "user-1",
        plaid_item_id: "plaid-item-1",
        institution_name: "Chase",
        access_token_ciphertext: "cipher",
        access_token_iv: "iv",
        access_token_tag: "tag",
        sync_cursor: null,
        status: "active",
        error_code: null,
      },
    ]);
    mockSetItemStatus.mockResolvedValue(undefined);

    // Mock DB throws on job insert/update
    mockServiceClient.from.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: new Error("DB Error") }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: new Error("Job Update Error") }),
      }),
    });

    const res = await syncAllForUser("user-1");
    expect(res).toEqual({ added: 0, modified: 0, removed: 0 });
    expect(mockLogError).toHaveBeenCalledWith("sync.job-record", expect.any(Error));
    expect(mockInvalidateDashboardCache).toHaveBeenCalledWith("user-1");
  });

  it("logs error when broken_bank notification throws", async () => {
    mockListActiveItems.mockResolvedValueOnce([
      {
        id: "item-1",
        user_id: "user-1",
        plaid_item_id: "plaid-item-1",
        institution_name: "Chase",
        access_token_ciphertext: "cipher",
        access_token_iv: "iv",
        access_token_tag: "tag",
        sync_cursor: null,
        status: "active",
        error_code: null,
      },
    ]);
    mockSetItemStatus.mockResolvedValue(undefined);
    mockCreateNotification.mockRejectedValueOnce(new Error("Notification failed"));

    mockServiceClient.from.mockImplementation(() => {
      throw new Error("Generic Sync Failure");
    });

    await syncAllForUser("user-1");
    expect(mockLogError).toHaveBeenCalledWith("sync.broken_bank_notification", expect.any(Error));
  });
});

