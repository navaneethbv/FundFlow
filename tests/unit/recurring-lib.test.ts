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

/**
 * Builds a `from()` dispatcher covering every table `refreshRecurringForItem`
 * touches (accounts, recurring_streams, transactions,
 * recurring_stream_transactions), so every test only needs to supply the
 * query results it actually cares about. The individual mock functions are
 * created once (not per `.from()` call) and returned alongside the
 * dispatcher so tests can assert on exactly what was passed to them.
 */
function createRecurringSupabaseMock(
  options: {
    accounts?: { data: unknown[] | null; error?: unknown };
    existingStreams?: { data: unknown[] | null; error?: unknown };
    upserted?: { data: unknown[] | null; error?: unknown };
    transactions?: { data: unknown[] | null; error?: unknown };
  } = {},
) {
  const accountsEq = vi.fn().mockResolvedValue(options.accounts ?? { data: [], error: null });
  const accountsSelect = vi.fn().mockReturnValue({ eq: accountsEq });

  const streamsEqItem = vi
    .fn()
    .mockResolvedValue(options.existingStreams ?? { data: [], error: null });
  const streamsEqUser = vi.fn().mockReturnValue({ eq: streamsEqItem });
  const streamsSelect = vi.fn().mockReturnValue({ eq: streamsEqUser });

  const upsertSelect = vi.fn().mockResolvedValue(options.upserted ?? { data: [], error: null });
  const upsert = vi.fn().mockReturnValue({ select: upsertSelect });

  const updateIn = vi.fn().mockResolvedValue({ error: null });
  const updateEq = vi.fn().mockReturnValue({ in: updateIn });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const txIn = vi.fn().mockResolvedValue(options.transactions ?? { data: [], error: null });
  const txEq = vi.fn().mockReturnValue({ in: txIn });
  const txSelect = vi.fn().mockReturnValue({ eq: txEq });

  // .delete().eq("recurring_stream_id", id).eq("user_id", userId) — two
  // chained .eq() calls, both load-bearing filters.
  const rstDeleteEqUser = vi.fn().mockResolvedValue({ error: null });
  const rstDeleteEq = vi.fn().mockReturnValue({ eq: rstDeleteEqUser });
  const rstDelete = vi.fn().mockReturnValue({ eq: rstDeleteEq });
  const rstInsert = vi.fn().mockResolvedValue({ error: null });

  const from = vi.fn().mockImplementation((table: string) => {
    switch (table) {
      case "accounts":
        return { select: accountsSelect };
      case "recurring_streams":
        return { select: streamsSelect, upsert, update };
      case "transactions":
        return { select: txSelect };
      case "recurring_stream_transactions":
        return { delete: rstDelete, insert: rstInsert };
      default:
        throw new Error(`Unexpected table ${table}`);
    }
  });

  return {
    from,
    accountsEq,
    streamsEqItem,
    upsert,
    upsertSelect,
    update,
    updateEq,
    updateIn,
    txEq,
    txIn,
    rstDelete,
    rstDeleteEq,
    rstDeleteEqUser,
    rstInsert,
  };
}

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
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: {
        data: [
          {
            stream_id: "stream-1",
            last_amount: 15.99, // prior amount
          },
        ],
        error: null,
      },
      upserted: {
        data: [{ id: "recurring-row-1", stream_id: "stream-1" }],
        error: null,
      },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    const count = await refreshRecurringForItem(dummyItem);

    expect(count).toBe(1);
    expect(mock.upsert).toHaveBeenCalledWith(
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

  it("resolves the stream's Plaid account id to the local account and persists occurrence fields", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            merchant_name: "Netflix",
            description: "Netflix Subscription",
            average_amount: { amount: 15.99 },
            last_amount: { amount: 15.99 },
            frequency: "MONTHLY",
            status: "MATURE",
            personal_finance_category: { primary: "ENTERTAINMENT" },
            is_active: true,
            account_id: "plaid-acct-1",
            first_date: "2026-01-15",
            last_date: "2026-06-15",
            predicted_next_date: "2026-07-15",
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      accounts: {
        data: [{ id: "local-acct-1", plaid_account_id: "plaid-acct-1" }],
        error: null,
      },
      existingStreams: { data: [], error: null },
      upserted: {
        data: [{ id: "recurring-row-1", stream_id: "stream-1" }],
        error: null,
      },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    await refreshRecurringForItem(dummyItem);

    expect(mock.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          account_id: "local-acct-1",
          first_date: "2026-01-15",
          last_date: "2026-06-15",
          predicted_next_date: "2026-07-15",
        }),
      ],
      { onConflict: "stream_id" },
    );
  });

  it("resolves a stream's Plaid transaction ids to local rows, replaces the join table, and omits unresolvable ids", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            merchant_name: "Netflix",
            description: "Netflix Subscription",
            last_amount: { amount: 15.99 },
            is_active: true,
            // "plaid-txn-resolvable" is present in the mocked transactions
            // table below; "plaid-txn-missing" is not (e.g. an older,
            // pruned transaction) and must be silently omitted.
            transaction_ids: ["plaid-txn-resolvable", "plaid-txn-missing"],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: { data: [], error: null },
      upserted: {
        data: [{ id: "recurring-row-1", stream_id: "stream-1" }],
        error: null,
      },
      transactions: {
        data: [{ id: "local-txn-1", plaid_transaction_id: "plaid-txn-resolvable" }],
        error: null,
      },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    await refreshRecurringForItem(dummyItem);

    // (c) delete happens before insert for that stream's recurring_stream_id.
    expect(mock.rstDeleteEq).toHaveBeenCalledWith("recurring_stream_id", "recurring-row-1");
    expect(mock.rstDeleteEqUser).toHaveBeenCalledWith("user_id", "user-1");
    const deleteOrder = mock.rstDelete.mock.invocationCallOrder[0];
    const insertOrder = mock.rstInsert.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(insertOrder);

    // (a) the resolvable id's LOCAL id ends up in the insert payload, and
    // (b) the unresolvable one is silently omitted, with nothing thrown.
    expect(mock.rstInsert).toHaveBeenCalledWith([
      {
        user_id: "user-1",
        recurring_stream_id: "recurring-row-1",
        transaction_id: "local-txn-1",
      },
    ]);
  });

  it("deactivates a stream missing from a full successful response without touching a failed refresh", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            merchant_name: "Netflix",
            description: "Netflix Subscription",
            last_amount: { amount: 15.99 },
            is_active: true,
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: {
        data: [
          { stream_id: "stream-1", last_amount: 15.99 },
          { stream_id: "gone-stream", last_amount: 9.99 },
        ],
        error: null,
      },
      upserted: {
        data: [{ id: "recurring-row-1", stream_id: "stream-1" }],
        error: null,
      },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    await refreshRecurringForItem(dummyItem);

    expect(mock.update).toHaveBeenCalledWith({ is_active: false });
    expect(mock.updateEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(mock.updateIn).toHaveBeenCalledWith("stream_id", ["gone-stream"]);
  });

  it("throws and never upserts when the accounts read fails, instead of silently unlinking every stream", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            merchant_name: "Netflix",
            description: "Netflix Subscription",
            last_amount: { amount: 15.99 },
            is_active: true,
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      accounts: { data: null, error: new Error("accounts read failed") },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    await expect(refreshRecurringForItem(dummyItem)).rejects.toThrow("accounts read failed");

    // A thrown accounts read must abort before the upsert -- otherwise every
    // stream in this sync would be persisted with account_id: null,
    // silently unlinking it from whatever account it was really tied to.
    expect(mock.upsert).not.toHaveBeenCalled();
  });

  it("never calls the deactivation update when the Plaid call throws", async () => {
    mockTransactionsRecurringGet.mockRejectedValueOnce(new Error("Plaid down"));

    await expect(refreshRecurringForItem(dummyItem)).rejects.toThrow("Plaid down");

    // The Plaid fetch is the very first thing the function does, so a
    // rejection there means the service client is never even created —
    // nothing downstream, including deactivation, can have been called.
    expect(mockServiceClient.from).not.toHaveBeenCalled();
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
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      upserted: {
        data: [{ id: "recurring-row-1", stream_id: "stream-1" }],
        error: null,
      },
    });
    mockServiceClient.from.mockImplementation(mock.from);

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

  it("handles inflow streams and new subscription alert error handling", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [
          {
            stream_id: "inflow-1",
            merchant_name: "Employer",
            description: "Payroll",
            last_amount: { amount: 3000 },
            is_active: true,
            transaction_ids: [],
          },
        ],
        outflow_streams: [
          {
            stream_id: "outflow-new",
            merchant_name: "Gym",
            description: "Membership",
            last_amount: { amount: 50 },
            is_active: true,
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: {
        data: [{ stream_id: "existing-old-stream", last_amount: 10 }],
        error: null,
      },
      upserted: {
        data: [
          { id: "row-1", stream_id: "inflow-1" },
          { id: "row-2", stream_id: "outflow-new" },
        ],
        error: null,
      },
    });
    mockServiceClient.from.mockImplementation(mock.from);
    mockCreateNotification.mockRejectedValueOnce(new Error("Notification failed"));

    const count = await refreshRecurringForItem(dummyItem);
    expect(count).toBe(2);
    expect(mockLogError).toHaveBeenCalledWith("recurring.alert.new_subscription", expect.any(Error));
  });

  it("maps missing stream fields to null and skips streams without an upserted row", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-null",
            merchant_name: "Plain",
            description: null,
            is_active: true,
            transaction_ids: [],
          },
          {
            stream_id: "stream-ghost",
            merchant_name: "Ghost",
            is_active: true,
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: { data: [], error: null },
      upserted: {
        data: [{ id: "row-1", stream_id: "stream-null" }],
        error: null,
      },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    const count = await refreshRecurringForItem(dummyItem);

    expect(count).toBe(2);
    expect(mock.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          stream_id: "stream-null",
          description: null,
          last_amount: null,
        }),
      ]),
      { onConflict: "stream_id" },
    );
    expect(mock.rstDelete).toHaveBeenCalledTimes(1);
  });

  it("chunks transaction id lookups into 500-id batches and tolerates a null read", async () => {
    const ids = Array.from({ length: 500 }, (_, i) => `plaid-txn-${i}`);
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            description: "Netflix",
            is_active: true,
            transaction_ids: ids,
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: { data: [], error: null },
      upserted: { data: [{ id: "row-1", stream_id: "stream-1" }], error: null },
      transactions: { data: null, error: null },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    await refreshRecurringForItem(dummyItem);

    expect(mock.txIn).toHaveBeenCalledWith("plaid_transaction_id", ids);
  });

  it("propagates a failed transaction id read", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            description: "Netflix",
            is_active: true,
            transaction_ids: ["t-1"],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: { data: [], error: null },
      upserted: { data: [{ id: "row-1", stream_id: "stream-1" }], error: null },
      transactions: { data: [], error: new Error("txn read failed") },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    await expect(refreshRecurringForItem(dummyItem)).rejects.toThrow("txn read failed");
  });

  it("throws when deactivating stale streams fails", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            description: "Netflix",
            is_active: true,
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: {
        data: [
          { stream_id: "stream-1", last_amount: 15.99 },
          { stream_id: "gone-stream", last_amount: 9.99 },
        ],
        error: null,
      },
      upserted: { data: [{ id: "row-1", stream_id: "stream-1" }], error: null },
    });
    mock.updateIn.mockResolvedValueOnce({ error: new Error("deactivate failed") });
    mockServiceClient.from.mockImplementation(mock.from);

    await expect(refreshRecurringForItem(dummyItem)).rejects.toThrow("deactivate failed");
  });

  it("throws when deleting a stream's old joins fails", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            description: "Netflix",
            is_active: true,
            transaction_ids: ["t-1"],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: { data: [], error: null },
      upserted: { data: [{ id: "row-1", stream_id: "stream-1" }], error: null },
      transactions: { data: [{ id: "local-1", plaid_transaction_id: "t-1" }], error: null },
    });
    mock.rstDeleteEqUser.mockResolvedValueOnce({ error: new Error("delete failed") });
    mockServiceClient.from.mockImplementation(mock.from);

    await expect(refreshRecurringForItem(dummyItem)).rejects.toThrow("delete failed");
  });

  it("throws when inserting a stream's new joins fails", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            description: "Netflix",
            is_active: true,
            transaction_ids: ["t-1"],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: { data: [], error: null },
      upserted: { data: [{ id: "row-1", stream_id: "stream-1" }], error: null },
      transactions: { data: [{ id: "local-1", plaid_transaction_id: "t-1" }], error: null },
    });
    mock.rstInsert.mockResolvedValueOnce({ error: new Error("insert failed") });
    mockServiceClient.from.mockImplementation(mock.from);

    await expect(refreshRecurringForItem(dummyItem)).rejects.toThrow("insert failed");
  });

  it("tolerates a null accounts read and persists streams without an account link", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            description: "Netflix",
            is_active: true,
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      accounts: { data: null, error: null },
      existingStreams: { data: [], error: null },
      upserted: { data: [{ id: "row-1", stream_id: "stream-1" }], error: null },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    await refreshRecurringForItem(dummyItem);

    expect(mock.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ stream_id: "stream-1", account_id: null }),
      ]),
      { onConflict: "stream_id" },
    );
  });

  it("throws when the stream upsert fails", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            description: "Netflix",
            is_active: true,
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: { data: [], error: null },
    });
    mock.upsertSelect.mockResolvedValueOnce({ data: [], error: new Error("upsert failed") });
    mockServiceClient.from.mockImplementation(mock.from);

    await expect(refreshRecurringForItem(dummyItem)).rejects.toThrow("upsert failed");
  });

  it("handles a null upsert response by skipping join replacement", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            description: "Netflix",
            is_active: true,
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: { data: [], error: null },
      upserted: { data: null, error: null },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    const count = await refreshRecurringForItem(dummyItem);

    expect(count).toBe(1);
    expect(mock.rstDelete).not.toHaveBeenCalled();
  });

  it("tolerates null stored stream rows", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            description: "Netflix",
            is_active: true,
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: { data: null, error: null },
      upserted: { data: [{ id: "row-1", stream_id: "stream-1" }], error: null },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    const count = await refreshRecurringForItem(dummyItem);
    expect(count).toBe(1);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it("handles a null stored last amount and falls back to description or Unknown for names", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            merchant_name: null,
            description: "Membership",
            is_active: true,
            last_amount: { amount: 50 },
            transaction_ids: [],
          },
          {
            stream_id: "stream-2",
            merchant_name: null,
            description: null,
            is_active: true,
            last_amount: { amount: 20 },
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: {
        data: [{ stream_id: "stream-1", last_amount: null }],
        error: null,
      },
      upserted: {
        data: [
          { id: "row-1", stream_id: "stream-1" },
          { id: "row-2", stream_id: "stream-2" },
        ],
        error: null,
      },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    const count = await refreshRecurringForItem(dummyItem);

    expect(count).toBe(2);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      "user-1",
      "new_subscription",
      expect.objectContaining({ title: expect.stringContaining("Unknown") }),
      "Unknown",
    );
  });

  it("logs and continues when a price hike notification fails", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          {
            stream_id: "stream-1",
            merchant_name: "Netflix",
            description: "Netflix Subscription",
            last_amount: { amount: 19.99 },
            is_active: true,
            transaction_ids: [],
          },
        ],
      },
    });

    const mock = createRecurringSupabaseMock({
      existingStreams: {
        data: [{ stream_id: "stream-1", last_amount: 15.99 }],
        error: null,
      },
      upserted: { data: [{ id: "row-1", stream_id: "stream-1" }], error: null },
    });
    mockCreateNotification.mockRejectedValueOnce(new Error("Notification failed"));
    mockServiceClient.from.mockImplementation(mock.from);

    const count = await refreshRecurringForItem(dummyItem);

    expect(count).toBe(1);
    expect(mockLogError).toHaveBeenCalledWith("recurring.alert.price_hike", expect.any(Error));
  });
});
