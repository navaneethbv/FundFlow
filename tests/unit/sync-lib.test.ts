import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTransactionsSync = vi.fn();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    transactionsSync: (...args: unknown[]) => mockTransactionsSync(...args),
  }),
}));

const mockServiceClient = {
  from: vi.fn(),
  rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
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
        "exact",
      );
      expect(mockCreateNotification).toHaveBeenCalledWith(
        "user-1",
        "cancellation_watch",
        expect.objectContaining({ title: expect.stringContaining("Netflix") }),
        "Netflix",
      );
      expect(mockUpdateItemCursor).toHaveBeenCalledWith("user-1", "item-db-1", "cursor-next");
      expect(mockSetItemStatus).toHaveBeenCalledWith("user-1", "item-db-1", "active", null);
    });

    it("skips the sync when another run already holds the item claim", async () => {
      mockServiceClient.rpc.mockResolvedValueOnce({ data: false, error: null });

      const res = await syncItemTransactions(dummyItem);

      expect(res).toEqual({ added: 0, modified: 0, removed: 0 });
      expect(mockTransactionsSync).not.toHaveBeenCalled();
      expect(mockUpdateItemCursor).not.toHaveBeenCalled();
      expect(mockServiceClient.rpc).toHaveBeenCalledWith("claim_item_sync", {
        p_item_id: "item-db-1",
        p_stale_seconds: 300,
      });
    });

    it("releases the claim after a successful sync", async () => {
      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: "cursor-next",
          has_more: false,
        },
      });
      mockServiceClient.from.mockImplementation(() => {
        throw new Error("Unexpected table");
      });

      const res = await syncItemTransactions(dummyItem);

      expect(res).toEqual({ added: 0, modified: 0, removed: 0 });
      expect(mockServiceClient.rpc).toHaveBeenCalledWith("release_item_sync", {
        p_item_id: "item-db-1",
      });
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

    it("proceeds without a claim when the claim RPC fails, and does not release", async () => {
      mockServiceClient.rpc.mockResolvedValueOnce({
        data: null,
        error: new Error("Claim error"),
      });
      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: null,
          has_more: false,
        },
      });

      const res = await syncItemTransactions(dummyItem);

      expect(res).toEqual({ added: 0, modified: 0, removed: 0 });
      expect(mockLogError).toHaveBeenCalledWith("sync.claim", expect.any(Error));
      expect(mockServiceClient.rpc).toHaveBeenCalledTimes(1);
      expect(mockUpdateItemCursor).not.toHaveBeenCalled();
    });

    it("drops transactions whose account is unknown to the user", async () => {
      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [
            {
              account_id: "unknown-acc",
              transaction_id: "txn-orphan",
              amount: 10,
              date: "2026-07-28",
            },
          ],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: "cursor-next",
          has_more: false,
        },
      });

      mockServiceClient.from.mockImplementation(() => {
        throw new Error("Unexpected table");
      });

      const res = await syncItemTransactions(dummyItem);

      expect(res).toEqual({ added: 1, modified: 0, removed: 0 });
      expect(mockUpdateItemCursor).toHaveBeenCalledWith("user-1", "item-db-1", "cursor-next");
      expect(mockSetItemStatus).toHaveBeenCalledWith("user-1", "item-db-1", "active", null);
    });

    it("falls back to defaults for alert thresholds and merchant names", async () => {
      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [
            {
              account_id: "plaid-acc-1",
              transaction_id: "txn-a",
              amount: 600,
              date: "2026-07-28",
              name: "POS MERCHANT",
            },
            {
              account_id: "plaid-acc-1",
              transaction_id: "txn-c",
              amount: 900,
              date: "2026-07-28",
            },
            {
              account_id: "plaid-acc-1",
              transaction_id: "txn-b",
              amount: 100,
              date: "2026-07-28",
            },
          ],
          modified: [],
          removed: [],
          accounts: [{ account_id: "plaid-acc-1", name: "Checking" }],
          next_cursor: "cursor-next",
          has_more: false,
        },
      });

      const upsertTxns = vi.fn().mockResolvedValue({ error: null });
      const maybeSingleAlert = vi.fn().mockResolvedValue({ data: null });
      const eqAlertUser = vi.fn().mockReturnValue({ maybeSingle: maybeSingleAlert });
      const selectAlert = vi.fn().mockReturnValue({ eq: eqAlertUser });
      const eqCancelledUser = vi.fn().mockResolvedValue({ data: [{ merchant: "NETFLIX" }] });
      const selectCancelled = vi.fn().mockReturnValue({ eq: eqCancelledUser });

      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "transactions") return { upsert: upsertTxns };
        if (table === "alert_preferences") return { select: selectAlert };
        if (table === "cancelled_subscriptions") return { select: selectCancelled };
        throw new Error(`Unexpected table ${table}`);
      });

      const res = await syncItemTransactions(dummyItem);

      expect(res).toEqual({ added: 3, modified: 0, removed: 0 });
      expect(mockCreateNotification).toHaveBeenCalledWith(
        "user-1",
        "large_transaction",
        expect.objectContaining({ title: "Large transaction: POS MERCHANT" }),
        "txn-a",
        "exact",
      );
      expect(mockCreateNotification).toHaveBeenCalledWith(
        "user-1",
        "large_transaction",
        expect.objectContaining({ title: "Large transaction: Unknown" }),
        "txn-c",
        "exact",
      );
      expect(mockCreateNotification).not.toHaveBeenCalledWith(
        "user-1",
        "large_transaction",
        expect.objectContaining({ title: expect.stringContaining("txn-b") }),
        expect.anything(),
      );
    });

    it("skips cancellation watching when there are no cancelled subscriptions", async () => {
      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [
            {
              account_id: "plaid-acc-1",
              transaction_id: "txn-1",
              amount: 50,
              date: "2026-07-28",
              merchant_name: "Spotify",
            },
          ],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: "cursor-next",
          has_more: false,
        },
      });

      const upsertTxns = vi.fn().mockResolvedValue({ error: null });
      const maybeSingleAlert = vi.fn().mockResolvedValue({ data: null });
      const eqAlertUser = vi.fn().mockReturnValue({ maybeSingle: maybeSingleAlert });
      const selectAlert = vi.fn().mockReturnValue({ eq: eqAlertUser });
      const eqCancelledUser = vi.fn().mockResolvedValue({ data: null });
      const selectCancelled = vi.fn().mockReturnValue({ eq: eqCancelledUser });

      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "transactions") return { upsert: upsertTxns };
        if (table === "alert_preferences") return { select: selectAlert };
        if (table === "cancelled_subscriptions") return { select: selectCancelled };
        throw new Error(`Unexpected table ${table}`);
      });

      await syncItemTransactions(dummyItem);

      expect(mockCreateNotification).not.toHaveBeenCalledWith(
        "user-1",
        "cancellation_watch",
        expect.anything(),
        expect.anything(),
      );
    });

    it("throws when deleting removed transactions fails", async () => {
      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [],
          modified: [],
          removed: [{ transaction_id: "txn-removed" }],
          accounts: [],
          next_cursor: "cursor-next",
          has_more: false,
        },
      });

      const eqDeleteIn = vi.fn().mockResolvedValue({ error: new Error("Delete error") });
      const eqDeleteUser = vi.fn().mockReturnValue({ in: eqDeleteIn });
      const deleteQuery = vi.fn().mockReturnValue({ eq: eqDeleteUser });
      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "transactions") return { delete: deleteQuery };
        throw new Error(`Unexpected table ${table}`);
      });

      await expect(syncItemTransactions(dummyItem)).rejects.toThrow("Delete error");
    });

    it("logs when the large transaction notification fails", async () => {
      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [
            {
              account_id: "plaid-acc-1",
              transaction_id: "txn-1",
              amount: 600,
              date: "2026-07-28",
              merchant_name: "Netflix",
            },
          ],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: "cursor-next",
          has_more: false,
        },
      });
      mockCreateNotification.mockRejectedValueOnce(new Error("Notification failed"));

      const upsertTxns = vi.fn().mockResolvedValue({ error: null });
      const maybeSingleAlert = vi.fn().mockResolvedValue({ data: null });
      const eqAlertUser = vi.fn().mockReturnValue({ maybeSingle: maybeSingleAlert });
      const selectAlert = vi.fn().mockReturnValue({ eq: eqAlertUser });
      const eqCancelledUser = vi.fn().mockResolvedValue({ data: null });
      const selectCancelled = vi.fn().mockReturnValue({ eq: eqCancelledUser });

      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "transactions") return { upsert: upsertTxns };
        if (table === "alert_preferences") return { select: selectAlert };
        if (table === "cancelled_subscriptions") return { select: selectCancelled };
        throw new Error(`Unexpected table ${table}`);
      });

      await syncItemTransactions(dummyItem);

      expect(mockLogError).toHaveBeenCalledWith("sync.large_txn_notification", expect.any(Error));
    });

    it("logs when releasing the item claim fails", async () => {
      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: "cursor-next",
          has_more: false,
        },
      });
      mockServiceClient.rpc
        .mockResolvedValueOnce({ data: true, error: null })
        .mockRejectedValueOnce(new Error("Release error"));

      const res = await syncItemTransactions(dummyItem);

      expect(res).toEqual({ added: 0, modified: 0, removed: 0 });
      expect(mockLogError).toHaveBeenCalledWith("sync.release", expect.any(Error));
    });

    it("logs when the cancelled subscriptions query fails", async () => {
      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [
            {
              account_id: "plaid-acc-1",
              transaction_id: "txn-1",
              amount: 50,
              date: "2026-07-28",
              merchant_name: "Spotify",
            },
          ],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: "cursor-next",
          has_more: false,
        },
      });

      const upsertTxns = vi.fn().mockResolvedValue({ error: null });
      const maybeSingleAlert = vi.fn().mockResolvedValue({ data: null });
      const eqAlertUser = vi.fn().mockReturnValue({ maybeSingle: maybeSingleAlert });
      const selectAlert = vi.fn().mockReturnValue({ eq: eqAlertUser });
      const eqCancelledUser = vi.fn().mockRejectedValue(new Error("Query failed"));
      const selectCancelled = vi.fn().mockReturnValue({ eq: eqCancelledUser });

      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "transactions") return { upsert: upsertTxns };
        if (table === "alert_preferences") return { select: selectAlert };
        if (table === "cancelled_subscriptions") return { select: selectCancelled };
        throw new Error(`Unexpected table ${table}`);
      });

      await syncItemTransactions(dummyItem);

      expect(mockLogError).toHaveBeenCalledWith("sync.cancellation_watch", expect.any(Error));
    });

    it("logs when the cancellation watch notification fails", async () => {
      mockTransactionsSync.mockResolvedValueOnce({
        data: {
          added: [
            {
              account_id: "plaid-acc-1",
              transaction_id: "txn-1",
              amount: 50,
              date: "2026-07-28",
              merchant_name: "Netflix",
            },
          ],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: "cursor-next",
          has_more: false,
        },
      });
      mockCreateNotification.mockRejectedValueOnce(new Error("Notification failed"));

      const upsertTxns = vi.fn().mockResolvedValue({ error: null });
      const maybeSingleAlert = vi.fn().mockResolvedValue({ data: null });
      const eqAlertUser = vi.fn().mockReturnValue({ maybeSingle: maybeSingleAlert });
      const selectAlert = vi.fn().mockReturnValue({ eq: eqAlertUser });
      const eqCancelledUser = vi.fn().mockResolvedValue({ data: [{ merchant: "Netflix" }] });
      const selectCancelled = vi.fn().mockReturnValue({ eq: eqCancelledUser });

      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "transactions") return { upsert: upsertTxns };
        if (table === "alert_preferences") return { select: selectAlert };
        if (table === "cancelled_subscriptions") return { select: selectCancelled };
        throw new Error(`Unexpected table ${table}`);
      });

      await syncItemTransactions(dummyItem);

      expect(mockLogError).toHaveBeenCalledWith("sync.cancellation_watch", expect.any(Error));
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
      expect(mockSetItemStatus).toHaveBeenCalledWith("user-1", "item-db-1", "error", "ITEM_LOGIN_REQUIRED");
      expect(mockCreateNotification).toHaveBeenCalledWith(
        "user-1",
        "broken_bank",
        expect.objectContaining({ title: expect.stringContaining("Chase Bank") }),
        "item-db-1",
      );
      expect(updateJob).toHaveBeenCalledWith({ status: "failed", last_error: "ITEM_LOGIN_REQUIRED" });
    });

    it("handles sync job record errors and null institution name fallback", async () => {
      const itemNoName: PlaidItemRow = { ...dummyItem, institution_name: null };
      mockListActiveItems.mockResolvedValue([itemNoName]);

      mockServiceClient.from.mockImplementation(() => {
        throw new Error("Job Record DB Error");
      });

      mockTransactionsSync.mockRejectedValueOnce(new Error("Generic Sync Error"));

      const res = await syncAllForUser("user-1");

      expect(res).toEqual({ added: 0, modified: 0, removed: 0 });
      expect(mockLogError).toHaveBeenCalledWith("sync.job-record", expect.any(Error));
      expect(mockCreateNotification).toHaveBeenCalledWith(
        "user-1",
        "broken_bank",
        expect.objectContaining({ title: "Bank connection issue: Bank" }),
        "item-db-1",
      );
    });

    it("logs and continues when recording the job end fails", async () => {
      mockListActiveItems.mockResolvedValue([dummyItem]);

      const singleJob = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null });
      const insertJob = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: singleJob }) });
      const eqJob = vi.fn().mockResolvedValue({ error: new Error("Job update error") });
      const updateJob = vi.fn().mockReturnValue({ eq: eqJob });

      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "sync_jobs") {
          return { insert: insertJob, update: updateJob };
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
      expect(mockLogError).toHaveBeenCalledWith("sync.job-record", expect.any(Error));
      expect(mockInvalidateDashboardCache).toHaveBeenCalledWith("user-1");
    });

    it("continues when setting the item status to error fails", async () => {
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

      mockTransactionsSync.mockRejectedValueOnce({
        response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } },
      });
      mockSetItemStatus.mockRejectedValueOnce(new Error("Set status failed"));

      const res = await syncAllForUser("user-1");

      expect(res).toEqual({ added: 0, modified: 0, removed: 0 });
      expect(mockCreateNotification).toHaveBeenCalledWith(
        "user-1",
        "broken_bank",
        expect.objectContaining({ title: expect.stringContaining("Chase Bank") }),
        "item-db-1",
      );
    });
  });
});
