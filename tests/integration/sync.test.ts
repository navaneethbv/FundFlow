import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { syncItemTransactions, syncAllForUser } from "@/lib/sync";
import { storeItem, getItem, getAccountIdMap } from "@/lib/plaid-service";

// Mock the Plaid client getter
const mockTransactionsSync = vi.fn();

vi.mock("@/lib/plaid", () => {
  return {
    getPlaidClient: () => {
      return {
        transactionsSync: mockTransactionsSync,
      };
    },
  };
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && secret);
const suite = run ? describe : describe.skip;

suite("sync transactions DB integration & mock Plaid", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  let userId = "";
  let itemDbId = "";
  const plaidItemId = `plaid-item-sync-${stamp}`;
  const plaidAccountId = `acct-sync-${stamp}`;
  const transactionId1 = `txn1-${stamp}`;
  const transactionId2 = `txn2-${stamp}`;

  beforeAll(async () => {
    // Create temporary user
    const { data, error } = await admin.auth.admin.createUser({
      email: `plaid-sync-${stamp}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    // Create item
    itemDbId = await storeItem({
      userId,
      plaidItemId,
      accessToken: "dummy-token",
      institutionId: "ins_sync",
      institutionName: "Sync Bank",
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (userId) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  it("adds and modifies transactions in the database on sync", async () => {
    // 1. Setup mock Plaid sync response
    mockTransactionsSync.mockResolvedValue({
      data: {
        added: [
          {
            transaction_id: transactionId1,
            account_id: plaidAccountId,
            amount: 15.75,
            iso_currency_code: "USD",
            date: "2026-06-01",
            authorized_date: "2026-06-01",
            name: "Starbucks Coffee",
            merchant_name: "Starbucks",
            personal_finance_category: {
              primary: "FOOD_AND_DRINK",
              detailed: "FOOD_AND_DRINK_COFFEE_SHOP",
            },
            payment_channel: "in store",
            pending: false,
          },
          {
            transaction_id: transactionId2,
            account_id: plaidAccountId,
            amount: 120.0,
            iso_currency_code: "USD",
            date: "2026-06-02",
            authorized_date: null,
            name: "Target Superstore",
            merchant_name: "Target",
            personal_finance_category: {
              primary: "SHOPS",
              detailed: "SHOPS_SUPERMARKETS",
            },
            payment_channel: "in store",
            pending: false,
          },
        ],
        modified: [],
        removed: [],
        accounts: [
          {
            account_id: plaidAccountId,
            name: "Checking",
            balances: {
              current: 1000,
              available: 950,
            },
            type: "depository",
          },
        ],
        next_cursor: "next-cursor-token-123",
        has_more: false,
      },
    });

    const item = await getItem(userId, itemDbId);
    const result = await syncItemTransactions(item!);

    // Verify mock was called
    expect(mockTransactionsSync).toHaveBeenCalledWith({
      access_token: "dummy-token",
      cursor: undefined,
    });

    // Verify result counts
    expect(result.added).toBe(2);
    expect(result.modified).toBe(0);
    expect(result.removed).toBe(0);

    // Verify database entries
    const accountMap = await getAccountIdMap(userId);
    const accountDbId = accountMap.get(plaidAccountId);
    expect(accountDbId).toBeTruthy();

    const { data: dbTransactions } = await admin
      .from("transactions")
      .select("plaid_transaction_id, amount, merchant_name, pfc_primary")
      .eq("user_id", userId)
      .order("plaid_transaction_id");

    expect(dbTransactions).toHaveLength(2);
    expect(dbTransactions![0].plaid_transaction_id).toBe(transactionId1);
    expect(Number(dbTransactions![0].amount)).toBe(15.75);
    expect(dbTransactions![0].merchant_name).toBe("Starbucks");
    expect(dbTransactions![0].pfc_primary).toBe("FOOD_AND_DRINK");

    expect(dbTransactions![1].plaid_transaction_id).toBe(transactionId2);
    expect(Number(dbTransactions![1].amount)).toBe(120.0);

    // Check that sync_cursor got saved
    const updatedItem = await getItem(userId, itemDbId);
    expect(updatedItem!.sync_cursor).toBe("next-cursor-token-123");
  });

  it("modifies and deletes transactions in subsequent sync", async () => {
    // 2. Setup mock for modified and deleted transactions
    mockTransactionsSync.mockResolvedValue({
      data: {
        added: [],
        modified: [
          {
            transaction_id: transactionId1,
            account_id: plaidAccountId,
            amount: 19.99, // modified amount
            iso_currency_code: "USD",
            date: "2026-06-01",
            name: "Starbucks Coffee (Modified)",
            merchant_name: "Starbucks",
            personal_finance_category: {
              primary: "FOOD_AND_DRINK",
            },
            payment_channel: "in store",
            pending: false,
          },
        ],
        removed: [
          {
            transaction_id: transactionId2, // remove Target transaction
          },
        ],
        accounts: [
          {
            account_id: plaidAccountId,
            name: "Checking",
            balances: {
              current: 980,
              available: 930,
            },
            type: "depository",
          },
        ],
        next_cursor: "next-cursor-token-456",
        has_more: false,
      },
    });

    const item = await getItem(userId, itemDbId);
    const result = await syncItemTransactions(item!);

    expect(result.added).toBe(0);
    expect(result.modified).toBe(1);
    expect(result.removed).toBe(1);

    // Verify DB states after modifications/deletions
    const { data: dbTransactions } = await admin
      .from("transactions")
      .select("plaid_transaction_id, amount, merchant_name")
      .eq("user_id", userId);

    expect(dbTransactions).toHaveLength(1);
    expect(dbTransactions![0].plaid_transaction_id).toBe(transactionId1);
    expect(Number(dbTransactions![0].amount)).toBe(19.99); // updated amount

    // Check that sync_cursor updated
    const updatedItem = await getItem(userId, itemDbId);
    expect(updatedItem!.sync_cursor).toBe("next-cursor-token-456");
  });

  it("runs syncAllForUser successfully", async () => {
    mockTransactionsSync.mockResolvedValue({
      data: {
        added: [],
        modified: [],
        removed: [],
        accounts: [
          {
            account_id: plaidAccountId,
            name: "Checking",
            balances: { current: 980, available: 930 },
            type: "depository",
          },
        ],
        next_cursor: "next-cursor-token-789",
        has_more: false,
      },
    });

    const total = await syncAllForUser(userId);
    expect(total.added).toBe(0);
    expect(total.modified).toBe(0);
    expect(total.removed).toBe(0);
  });

  it("rejects unknown-account transactions without advancing the cursor", async () => {
    mockTransactionsSync.mockResolvedValue({
      data: {
        added: [
          {
            transaction_id: `txn-unknown-${stamp}`,
            account_id: "non-existent-account-id",
            amount: 50.0,
            date: "2026-06-01",
          },
        ],
        modified: [],
        removed: [],
        accounts: [], // no accounts upserted
        next_cursor: "cursor-ignore-123",
        has_more: false,
      },
    });

    const item = await getItem(userId, itemDbId);
    await expect(syncItemTransactions(item!)).rejects.toThrow(
      "Unknown Plaid account non-existent-account-id",
    );

    const { data: checkTxn } = await admin
      .from("transactions")
      .select("id")
      .eq("plaid_transaction_id", `txn-unknown-${stamp}`)
      .maybeSingle();

    expect(checkTxn).toBeNull();
    const after = await getItem(userId, itemDbId);
    expect(after?.sync_cursor).toBe(item?.sync_cursor);
  });

  it("isolates sync failures per item in syncAllForUser", async () => {
    // Seed another active item for the user
    const secondItemDbId = await storeItem({
      userId,
      plaidItemId: `plaid-item-sync-2-${stamp}`,
      accessToken: "dummy-token-2",
    });

    // Database row order is intentionally unspecified, so tie the failure to
    // the original item's token instead of assuming which item runs first.
    mockTransactionsSync.mockImplementation(
      ({ access_token: accessToken }: { access_token: string }) => {
        if (accessToken === "dummy-token") {
          return Promise.reject(new Error("Plaid API offline"));
        }
        return Promise.resolve({
          data: {
            added: [],
            modified: [],
            removed: [],
            accounts: [],
            next_cursor: "cursor-second-success",
            has_more: false,
          },
        });
      },
    );

    const total = await syncAllForUser(userId);
    // Since first item failed, total should represent the successful syncs (0/0/0)
    expect(total).toEqual({ added: 0, modified: 0, removed: 0 });

    // Verify first item status is error
    const firstItem = await getItem(userId, itemDbId);
    expect(firstItem!.status).toBe("error");
    expect(firstItem!.error_code).toBe("sync_failed");

    // Verify second item status is active (success)
    const secondItem = await getItem(userId, secondItemDbId);
    expect(secondItem!.status).toBe("active");

    // Clean up second item
    await admin.from("plaid_items").delete().eq("id", secondItemDbId);
  });

  it("upserts by provider transaction id so a re-sync never duplicates rows", async () => {
    const txnId = `txn-dup-${stamp}`;
    mockTransactionsSync.mockResolvedValue({
      data: {
        added: [
          {
            transaction_id: txnId,
            account_id: plaidAccountId,
            amount: 9.99,
            iso_currency_code: "USD",
            date: "2026-06-03",
            name: "Dup Merchant",
            merchant_name: "Dup",
            personal_finance_category: { primary: "SHOPS" },
            payment_channel: "online",
            pending: false,
          },
        ],
        modified: [],
        removed: [],
        accounts: [{ account_id: plaidAccountId, name: "Checking", balances: {} }],
        next_cursor: `cursor-dup-${stamp}`,
        has_more: false,
      },
    });

    const item = await getItem(userId, itemDbId);
    await syncItemTransactions(item!);
    // A second run returns the same transaction; the upsert must not create a
    // second row.
    await syncItemTransactions(item!);

    const { data: rows } = await admin
      .from("transactions")
      .select("id")
      .eq("plaid_transaction_id", txnId)
      .eq("user_id", userId);
    expect(rows).toHaveLength(1);
  });

  it("records item-scoped cursor health on success and on failure", async () => {
    const attemptTxnId = `txn-health-${stamp}`;
    mockTransactionsSync.mockResolvedValue({
      data: {
        added: [
          {
            transaction_id: attemptTxnId,
            account_id: plaidAccountId,
            amount: 5.0,
            iso_currency_code: "USD",
            date: "2026-06-04",
            name: "Health Merchant",
            payment_channel: "in store",
            pending: false,
          },
        ],
        modified: [],
        removed: [],
        accounts: [{ account_id: plaidAccountId, name: "Checking", balances: {} }],
        next_cursor: `cursor-health-${stamp}`,
        has_more: false,
      },
    });

    const item = await getItem(userId, itemDbId);
    const result = await syncItemTransactions(item!);
    expect(result.added).toBe(1);

    const after = await getItem(userId, itemDbId);
    expect(after!.last_sync_attempt_at).toBeTruthy();
    expect(after!.last_sync_success_at).toBeTruthy();
    expect(after!.last_sync_completed_pages).toBe(true);
    expect(after!.initial_history_incomplete).toBe(false);
    expect(after!.cursor_reset_detected_at).toBeNull();

    // A failed run must record completed_pages = false.
    mockTransactionsSync.mockRejectedValueOnce({
      response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } },
    });
    await expect(syncItemTransactions(after!)).rejects.toThrow();
    const afterFailure = await getItem(userId, itemDbId);
    expect(afterFailure!.last_sync_completed_pages).toBe(false);
  });
});
