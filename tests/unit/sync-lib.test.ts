import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTransactionsSync = vi.fn();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    transactionsSync: (...args: unknown[]) => mockTransactionsSync(...args),
  }),
}));

const mockServiceClient = {
  from: vi.fn(),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockDecryptItemTokenAndUpgrade = vi.fn().mockResolvedValue("access-token-123");
const mockUpsertAccounts = vi.fn().mockResolvedValue(undefined);
const mockGetAccountIdMap = vi.fn().mockResolvedValue(new Map([["plaid-acc-1", "db-acc-1"]]));
const mockUpdateItemCursor = vi.fn().mockResolvedValue(undefined);
const mockSetItemStatus = vi.fn().mockResolvedValue(undefined);
const mockListActiveItems = vi.fn();

vi.mock("@/lib/plaid-service", () => ({
  decryptItemTokenAndUpgrade: (...args: unknown[]) => mockDecryptItemTokenAndUpgrade(...args),
  upsertAccounts: (...args: unknown[]) => mockUpsertAccounts(...args),
  getAccountIdMap: (...args: unknown[]) => mockGetAccountIdMap(...args),
  updateItemCursor: (...args: unknown[]) => mockUpdateItemCursor(...args),
  setItemStatus: (...args: unknown[]) => mockSetItemStatus(...args),
  listActiveItems: (...args: unknown[]) => mockListActiveItems(...args),
}));

const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/notifications", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

const mockInvalidateDashboardCache = vi.fn();
vi.mock("@/lib/dashboard-cache", () => ({
  invalidateDashboardCache: (...args: unknown[]) => mockInvalidateDashboardCache(...args),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { syncItemTransactions, syncAllForUser } from "@/lib/sync";
import type { PlaidItemRow } from "@/lib/types";

describe("lib/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const dummyItem: PlaidItemRow = {
    id: "item-db-1",
    user_id: "user-1",
    plaid_item_id: "plaid-item-1",
    institution_id: "inst-1",
    institution_name: "Chase Bank",
    access_token_ciphertext: "cipher",
    access_token_iv: "iv",
    access_token_tag: "tag",
    sync_cursor: "cursor-0",
    status: "active",
    error_code: null,
  };

  describe("syncItemTransactions", () => {
    it("fetches pages from Plaid, upserts transactions, handles large txns and cancelled subscriptions, and updates cursor", async () => {
      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [
            {
              account_id: "plaid-acc-1",
              transaction_id: "txn-1",
              amount: 600, // triggers large transaction notification (>500 default)
              date: "2026-07-28",
              merchant_name: "Netflix",
              name: "NETFLIX.COM",
              personal_finance_category: { primary: "ENTERTAINMENT" },
            },
          ],
          modified: [],
          removed: [{ transaction_id: "txn-old" }],
          accounts: [{ account_id: "plaid-acc-1", name: "Checking" }],
          next_cursor: "cursor-next",
          has_more: false,
        },
      });

      // Mock database queries
      const upsertTxns = vi.fn().mockResolvedValue({ error: null });

      const maybeSingleAlert = vi.fn().mockResolvedValue({
        data: { large_transaction_threshold: 500 },
      });
      const eqAlertUser = vi.fn().mockReturnValue({ maybeSingle: maybeSingleAlert });
      const selectAlert = vi.fn().mockReturnValue({ eq: eqAlertUser });

      const eqCancelledUser = vi.fn().mockResolvedValue({
        data: [{ merchant: "Netflix" }],
      });
      const selectCancelled = vi.fn().mockReturnValue({ eq: eqCancelledUser });

      const eqDeleteIn = vi.fn().mockResolvedValue({ error: null });
      const eqDeleteUser = vi.fn().mockReturnValue({ in: eqDeleteIn });
      const deleteQuery = vi.fn().mockReturnValue({ eq: eqDeleteUser });

      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "transactions") {
          return {
            upsert: upsertTxns,
            delete: deleteQuery,
          };
        }
        if (table === "alert_preferences") {
          return { select: selectAlert };
        }
        if (table === "cancelled_subscriptions") {
          return { select: selectCancelled };
        }
        throw new Error(`Unexpected table ${table}`);
      });

      const res = await syncItemTransactions(dummyItem);

      expect(res).toEqual({ added: 1, modified: 0, removed: 1 });
      expect(mockDecryptItemTokenAndUpgrade).toHaveBeenCalledWith(dummyItem);
      expect(mockUpsertAccounts).toHaveBeenCalled();
      expect(upsertTxns).toHaveBeenCalled();
      expect(mockCreateNotification).toHaveBeenCalledWith(
        "user-1",
        "large_transaction",
        expect.objectContaining({ title: expect.stringContaining("Netflix") }),
        "txn-1",
      );
      expect(mockCreateNotification).toHaveBeenCalledWith(
        "user-1",
        "cancellation_watch",
        expect.objectContaining({ title: expect.stringContaining("Netflix") }),
        "Netflix",
      );
      expect(mockUpdateItemCursor).toHaveBeenCalledWith("item-db-1", "cursor-next");
      expect(mockSetItemStatus).toHaveBeenCalledWith("item-db-1", "active", null);
    });

    it("throws error if transactions upsert fails", async () => {
      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [
            {
              account_id: "plaid-acc-1",
              transaction_id: "txn-1",
              amount: 50,
              date: "2026-07-28",
            },
          ],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: "cursor-1",
          has_more: false,
        },
      });

      const upsertTxns = vi.fn().mockResolvedValue({ error: new Error("Upsert error") });
      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "transactions") return { upsert: upsertTxns };
        throw new Error(`Unexpected table ${table}`);
      });

      await expect(syncItemTransactions(dummyItem)).rejects.toThrow("Upsert error");
      expect(mockUpdateItemCursor).not.toHaveBeenCalled();
    });
  });

  describe("syncAllForUser", () => {
    it("syncs all items, creates job records, invalidates dashboard cache, and returns total", async () => {
      mockListActiveItems.mockResolvedValue([dummyItem]);

      const singleJob = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null });
      const insertJob = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: singleJob }) });

      const eqJob = vi.fn().mockResolvedValue({ error: null });
      const updateJob = vi.fn().mockReturnValue({ eq: eqJob });

      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "sync_jobs") {
          return {
            insert: insertJob,
            update: updateJob,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      });

      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: "cursor-1",
          has_more: false,
        },
      });

      const res = await syncAllForUser("user-1");

      expect(res).toEqual({ added: 0, modified: 0, removed: 0 });
      expect(mockInvalidateDashboardCache).toHaveBeenCalledWith("user-1");
      expect(updateJob).toHaveBeenCalledWith({ status: "done", last_error: null });
    });

    it("handles item sync failure gracefully, records failed status and broken_bank notification", async () => {
      mockListActiveItems.mockResolvedValue([dummyItem]);

      const singleJob = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null });
      const insertJob = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: singleJob }) });
      const eqJob = vi.fn().mockResolvedValue({ error: null });
      const updateJob = vi.fn().mockReturnValue({ eq: eqJob });

      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "sync_jobs") {
          return { insert: insertJob, update: updateJob };
        }
        throw new Error(`Unexpected table ${table}`);
      });

      const plaidError = {
        response: {
          data: {
            error_code: "ITEM_LOGIN_REQUIRED",
          },
        },
      };
      mockTransactionsSync.mockRejectedValueOnce(plaidError);

      const res = await syncAllForUser("user-1");

      expect(res).toEqual({ added: 0, modified: 0, removed: 0 });
      expect(mockSetItemStatus).toHaveBeenCalledWith("item-db-1", "error", "ITEM_LOGIN_REQUIRED");
      expect(mockCreateNotification).toHaveBeenCalledWith(
        "user-1",
        "broken_bank",
        expect.objectContaining({ title: expect.stringContaining("Chase Bank") }),
        "item-db-1",
      );
      expect(updateJob).toHaveBeenCalledWith({ status: "failed", last_error: "ITEM_LOGIN_REQUIRED" });
    });
  });
});
