import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTransactionsSync = vi.fn();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    transactionsSync: (...args: unknown[]) => mockTransactionsSync(...args),
  }),
}));

const mockServiceClient = {
  from: vi.fn(),
  rpc: vi.fn(),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockDecryptItemTokenAndUpgrade = vi.fn().mockResolvedValue("access-token-123");
const mockUpsertAccounts = vi.fn().mockResolvedValue(undefined);
const mockGetAccountIdMap = vi.fn().mockResolvedValue(new Map([["plaid-acc-1", "db-acc-1"]]));
const mockClearItemRepairCursor = vi.fn().mockResolvedValue(undefined);
const mockCompleteItemCursor = vi.fn().mockResolvedValue(undefined);
const mockUpdateItemRepairCursor = vi.fn().mockResolvedValue(undefined);
const mockSetItemStatus = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/plaid-service", () => ({
  decryptItemTokenAndUpgrade: (...args: unknown[]) => mockDecryptItemTokenAndUpgrade(...args),
  upsertAccounts: (...args: unknown[]) => mockUpsertAccounts(...args),
  getAccountIdMap: (...args: unknown[]) => mockGetAccountIdMap(...args),
  clearItemRepairCursor: (...args: unknown[]) => mockClearItemRepairCursor(...args),
  completeItemCursor: (...args: unknown[]) => mockCompleteItemCursor(...args),
  updateItemRepairCursor: (...args: unknown[]) => mockUpdateItemRepairCursor(...args),
  setItemStatus: (...args: unknown[]) => mockSetItemStatus(...args),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { backfillItemTransactions } from "@/lib/sync";
import type { PlaidItemRow } from "@/lib/types";

describe("backfillItemTransactions (bounded repair backfill)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransactionsSync.mockReset();
    mockServiceClient.rpc.mockResolvedValue({ data: true, error: null });
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
    sync_cursor: null,
    status: "active",
    error_code: null,
  };

  it("pages up to the bound and reports the bounded result without claiming completion", async () => {
    mockTransactionsSync
      .mockResolvedValueOnce({
        data: {
          added: [
            {
              account_id: "plaid-acc-1",
              transaction_id: "txn-1",
              amount: 10,
              date: "2026-08-01",
            },
          ],
          modified: [],
          removed: [],
          accounts: [{ account_id: "plaid-acc-1", name: "Checking" }],
          next_cursor: "cursor-1",
          has_more: true,
        },
      })
      .mockResolvedValueOnce({
        data: {
          added: [],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: "cursor-2",
          has_more: true,
        },
      })
      .mockResolvedValueOnce({
        data: {
          added: [],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: "cursor-3",
          has_more: true,
        },
      });

    const upsertTxns = vi.fn().mockResolvedValue({ error: null });
    const eqDeleteIn = vi.fn().mockResolvedValue({ error: null });
    const eqDeleteUser = vi.fn().mockReturnValue({ in: eqDeleteIn });
    const deleteQuery = vi.fn().mockReturnValue({ eq: eqDeleteUser });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "transactions") return { upsert: upsertTxns, delete: deleteQuery };
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await backfillItemTransactions(dummyItem, { maxPages: 2 });

    expect(mockTransactionsSync).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      pagesCompleted: 2,
      maxPages: 2,
      completed: false,
      added: 1,
      modified: 0,
      removed: 0,
    });
    expect(mockUpdateItemRepairCursor).toHaveBeenCalledWith("user-1", "item-db-1", "cursor-2");
    expect(mockCompleteItemCursor).not.toHaveBeenCalled();
    expect(mockSetItemStatus).toHaveBeenCalledWith("user-1", "item-db-1", "active", null);
    expect(mockServiceClient.rpc).toHaveBeenCalledWith("claim_item_sync", {
      p_item_id: "item-db-1",
      p_stale_seconds: 300,
    });
    expect(mockServiceClient.rpc).toHaveBeenCalledWith("release_item_sync", {
      p_item_id: "item-db-1",
    });
  });

  it("does not call Plaid when another sync owns the item claim", async () => {
    mockServiceClient.rpc.mockResolvedValueOnce({ data: false, error: null });

    await expect(
      backfillItemTransactions(dummyItem, { maxPages: 2 }),
    ).rejects.toThrow(/already in progress/i);
    expect(mockTransactionsSync).not.toHaveBeenCalled();
    expect(mockUpdateItemRepairCursor).not.toHaveBeenCalled();
    expect(mockCompleteItemCursor).not.toHaveBeenCalled();
  });

  it("reports completed when has_more is false inside the bound", async () => {
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [],
        modified: [],
        removed: [{ transaction_id: "txn-old" }],
        accounts: [],
        next_cursor: "cursor-final",
        has_more: false,
      },
    });

    const upsertTxns = vi.fn().mockResolvedValue({ error: null });
    const eqDeleteIn = vi.fn().mockResolvedValue({ error: null });
    const eqDeleteUser = vi.fn().mockReturnValue({ in: eqDeleteIn });
    const deleteQuery = vi.fn().mockReturnValue({ eq: eqDeleteUser });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "transactions") return { upsert: upsertTxns, delete: deleteQuery };
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await backfillItemTransactions(dummyItem, { maxPages: 5 });

    expect(mockTransactionsSync).toHaveBeenCalledTimes(1);
    expect(result.completed).toBe(true);
    expect(mockCompleteItemCursor).toHaveBeenCalledWith(
      "user-1",
      "item-db-1",
      "cursor-final",
    );
    expect(eqDeleteIn).toHaveBeenCalledWith("plaid_transaction_id", ["txn-old"]);
  });

  it("applies explicit Plaid tombstones even on a bounded run but never sweeps absent rows", async () => {
    mockTransactionsSync
      .mockResolvedValueOnce({
        data: {
          added: [],
          modified: [],
          removed: [{ transaction_id: "txn-removed" }],
          accounts: [],
          next_cursor: "cursor-1",
          has_more: true,
        },
      })
      .mockResolvedValueOnce({
        data: {
          added: [],
          modified: [],
          removed: [],
          accounts: [],
          next_cursor: "cursor-2",
          has_more: true,
        },
      });

    const upsertTxns = vi.fn().mockResolvedValue({ error: null });
    const eqDeleteIn = vi.fn().mockResolvedValue({ error: null });
    const eqDeleteUser = vi.fn().mockReturnValue({ in: eqDeleteIn });
    const deleteQuery = vi.fn().mockReturnValue({ eq: eqDeleteUser });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "transactions") return { upsert: upsertTxns, delete: deleteQuery };
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await backfillItemTransactions(dummyItem, { maxPages: 2 });

    expect(result.completed).toBe(false);
    expect(eqDeleteIn).toHaveBeenCalledWith("plaid_transaction_id", ["txn-removed"]);
    // The delete is scoped to the owning user.
    expect(eqDeleteUser).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("upserts by plaid_transaction_id so retries stay idempotent", async () => {
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [
          {
            account_id: "plaid-acc-1",
            transaction_id: "txn-1",
            amount: 10,
            date: "2026-08-01",
          },
        ],
        modified: [],
        removed: [],
        accounts: [{ account_id: "plaid-acc-1", name: "Checking" }],
        next_cursor: "cursor-final",
        has_more: false,
      },
    });

    const upsertTxns = vi.fn().mockResolvedValue({ error: null });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "transactions") return { upsert: upsertTxns };
      throw new Error(`Unexpected table ${table}`);
    });

    await backfillItemTransactions(dummyItem, { maxPages: 5 });
    expect(upsertTxns).toHaveBeenCalledWith(
      [expect.objectContaining({ plaid_transaction_id: "txn-1" })],
      { onConflict: "plaid_transaction_id" },
    );
  });

  it("resumes from the repair cursor but clears it on a pagination mutation", async () => {
    const mutationError = Object.assign(new Error("transaction data changed"), {
      response: {
        data: {
          error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
        },
      },
    });
    mockTransactionsSync.mockRejectedValueOnce(mutationError);
    const partiallyRepairedItem: PlaidItemRow = {
      ...dummyItem,
      sync_cursor: "committed-cursor",
      repair_sync_cursor: "repair-cursor-8",
      repair_sync_started_at: "2026-08-30T12:00:00.000Z",
    };

    await expect(
      backfillItemTransactions(partiallyRepairedItem, { maxPages: 2 }),
    ).rejects.toThrow("transaction data changed");

    expect(mockTransactionsSync).toHaveBeenCalledWith({
      access_token: "access-token-123",
      cursor: "repair-cursor-8",
    });
    expect(mockClearItemRepairCursor).toHaveBeenCalledWith(
      "user-1",
      "item-db-1",
    );
    expect(mockCompleteItemCursor).not.toHaveBeenCalled();
  });
});
