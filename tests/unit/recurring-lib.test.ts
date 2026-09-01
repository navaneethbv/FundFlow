import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTransactionsRecurringGet = vi.fn();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    transactionsRecurringGet: (...args: unknown[]) => mockTransactionsRecurringGet(...args),
  }),
}));

const mockServiceClient = {
  from: vi.fn(),
  rpc: vi.fn(),
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

const mockRefreshInferredRecurringForUser = vi.fn();
vi.mock("@/lib/recurring-inference", () => ({
  refreshInferredRecurringForUser: (...args: unknown[]) => mockRefreshInferredRecurringForUser(...args),
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
  const accountsEqItem = vi.fn().mockResolvedValue(options.accounts ?? { data: [], error: null });
  const accountsEq = vi.fn().mockReturnValue({ eq: accountsEqItem });
  const accountsSelect = vi.fn().mockReturnValue({ eq: accountsEq });

  const configuredExistingStreams = options.existingStreams ?? { data: [], error: null };
  const streamsEqSource = vi.fn().mockImplementation((column: string, value: string) => {
    if (column !== "source") return Promise.resolve(configuredExistingStreams);
    const response = Promise.resolve({
      ...configuredExistingStreams,
      data: configuredExistingStreams.data?.filter((row) => ((row as { source?: string }).source ?? "plaid") === value),
    });
    Object.assign(response, {
      eq: vi.fn().mockResolvedValue({
        ...configuredExistingStreams,
        data: configuredExistingStreams.data?.filter((row) => ((row as { source?: string }).source ?? "plaid") === value),
      }),
    });
    return response;
  });
  const streamsEqItem = vi.fn().mockReturnValue({ eq: streamsEqSource });
  const streamsEqUser = vi.fn().mockReturnValue({ eq: streamsEqItem });
  const streamsSelect = vi.fn().mockReturnValue({ eq: streamsEqUser });

  const upsertSelect = vi.fn().mockResolvedValue(options.upserted ?? { data: [], error: null });
  const upsert = vi.fn().mockReturnValue({ select: upsertSelect });

  const updateIn = vi.fn().mockResolvedValue({ error: null });
  const updateEqSource = vi.fn().mockReturnValue({ in: updateIn });
  const updateEq = vi.fn().mockReturnValue({ eq: updateEqSource });
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
  const rpc = vi.fn().mockImplementation(async (_name: string, args: { p_payload: { streams: unknown[]; joins: Array<{ stream_id: string; transaction_ids: string[] }> } }) => {
    const payload = args.p_payload;
    const upsertResult = options.upserted ?? { data: [], error: null };
    if (!upsertResult.error) {
      const write = await upsert(payload.streams, { onConflict: "stream_id" }).select();
      if (write.error) return { data: null, error: write.error };
      const current = new Set(payload.streams.map((stream) => (stream as { stream_id: string }).stream_id));
      const stale = (configuredExistingStreams.data ?? [])
        .filter((row) => ((row as { source?: string }).source ?? "plaid") === "plaid")
        .map((row) => (row as { stream_id: string }).stream_id)
        .filter((streamId) => !current.has(streamId));
      if (stale.length > 0) {
        const staleResult = await update({ is_active: false }).eq("user_id", "user-1").eq("source", "plaid").in("stream_id", stale);
        if (staleResult.error) return { data: null, error: staleResult.error };
      }
      for (const join of payload.joins) {
        const row = (upsertResult.data ?? []).find((candidate) => (candidate as { stream_id: string }).stream_id === join.stream_id) as { id: string } | undefined;
        if (!row) continue;
        const deleteResult = await rstDelete().eq("recurring_stream_id", row.id).eq("user_id", "user-1");
        if (deleteResult.error) return { data: null, error: deleteResult.error };
        if (join.transaction_ids.length > 0) {
          const insertResult = await rstInsert(join.transaction_ids.map((transactionId) => ({ user_id: "user-1", recurring_stream_id: row.id, transaction_id: transactionId })));
          if (insertResult.error) return { data: null, error: insertResult.error };
        }
      }
    }
    return { data: { plaid: payload.streams.length }, error: upsertResult.error ?? null };
  });

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

  mockServiceClient.rpc = rpc;

  return {
    from,
    accountsEq,
    accountsEqItem,
    streamsEqItem,
    streamsEqSource,
    upsert,
    upsertSelect,
    update,
    updateEq,
    updateEqSource,
    updateIn,
    txEq,
    txIn,
    rstDelete,
    rstDeleteEq,
    rstDeleteEqUser,
    rstInsert,
    rpc,
  };
}

describe("lib/recurring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshInferredRecurringForUser.mockResolvedValue({
      active: 0,
      added: 0,
      deactivated: 0,
      deduplicated: 0,
      failed: 0,
    });
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

    const mock = createRecurringSupabaseMock();
    mockServiceClient.from.mockImplementation(mock.from);
    const count = await refreshRecurringForItem(dummyItem);
    expect(count).toBe(0);
    expect(mock.streamsEqSource).toHaveBeenCalledWith("source", "plaid");
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
          source: "plaid",
          identity_key: expect.stringMatching(/^recurring-v1:/),
          first_date: "2026-01-15",
          last_date: "2026-06-15",
          predicted_next_date: "2026-07-15",
        }),
      ],
      { onConflict: "stream_id" },
    );
  });

  it("hashes Plaid semi-monthly and annual identities but leaves unknown cadence identity null", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: {
        inflow_streams: [],
        outflow_streams: [
          { stream_id: "semi", merchant_name: "Semi", description: "Semi", frequency: "SEMI_MONTHLY", account_id: "plaid-acct-1", transaction_ids: [] },
          { stream_id: "annual", merchant_name: "Annual", description: "Annual", frequency: "ANNUALLY", account_id: "plaid-acct-1", transaction_ids: [] },
          { stream_id: "unknown", merchant_name: "Unknown", description: "Unknown", frequency: "UNKNOWN", account_id: "plaid-acct-1", transaction_ids: [] },
        ],
      },
    });
    const mock = createRecurringSupabaseMock({
      accounts: { data: [{ id: "local-acct-1", plaid_account_id: "plaid-acct-1" }], error: null },
      upserted: { data: [], error: null },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    await refreshRecurringForItem(dummyItem);

    const payload = mock.rpc.mock.calls[0]?.[1] as { p_payload: { streams: Array<{ stream_id: string; identity_key: string | null }> } };
    expect(payload.p_payload.streams).toEqual(expect.arrayContaining([
      expect.objectContaining({ stream_id: "semi", identity_key: expect.stringMatching(/^recurring-v1:/) }),
      expect.objectContaining({ stream_id: "annual", identity_key: expect.stringMatching(/^recurring-v1:/) }),
      expect.objectContaining({ stream_id: "unknown", identity_key: null }),
    ]));
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
    expect(total).toEqual({
      plaid: 1,
      inferred: { active: 0, added: 0, deactivated: 0, deduplicated: 0, failed: 0 },
    });
  });

  it("refreshRecurringForUser isolates errors per item and logs error", async () => {
    mockListActiveItems.mockResolvedValue([dummyItem]);
    mockTransactionsRecurringGet.mockRejectedValueOnce(new Error("API Error"));

    const total = await refreshRecurringForUser("user-1");
    expect(total).toEqual({
      plaid: 0,
      inferred: { active: 0, added: 0, deactivated: 0, deduplicated: 0, failed: 0 },
    });
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

  it("marks only stored Plaid rows stale for a valid empty snapshot and still reports local inference", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce({
      data: { inflow_streams: [], outflow_streams: [] },
    });
    mockRefreshInferredRecurringForUser.mockResolvedValueOnce({
      active: 1,
      added: 0,
      deactivated: 0,
      deduplicated: 0,
      failed: 0,
    });
    mockListActiveItems.mockResolvedValueOnce([dummyItem]);

    const mock = createRecurringSupabaseMock({
      existingStreams: {
        data: [
          { stream_id: "gone-plaid", last_amount: 9.99, source: "plaid" },
          { stream_id: "keep-inferred", last_amount: 9.99, source: "inferred" },
        ],
        error: null,
      },
    });
    mockServiceClient.from.mockImplementation(mock.from);

    const result = await refreshRecurringForUser("user-1");

    expect(result).toEqual({
      plaid: 0,
      inferred: { active: 1, added: 0, deactivated: 0, deduplicated: 0, failed: 0 },
    });
    expect(mock.streamsEqSource).toHaveBeenCalledWith("source", "plaid");
    expect(mock.updateEqSource).toHaveBeenCalledWith("source", "plaid");
    expect(mock.updateIn).toHaveBeenCalledWith("stream_id", ["gone-plaid"]);
    expect(mockRefreshInferredRecurringForUser).toHaveBeenCalledWith("user-1");
  });

  it("runs local inference after a Plaid item error while preserving provider rows", async () => {
    mockListActiveItems.mockResolvedValueOnce([dummyItem]);
    mockTransactionsRecurringGet.mockRejectedValueOnce(new Error("Plaid unavailable"));
    mockRefreshInferredRecurringForUser.mockResolvedValueOnce({
      active: 2,
      added: 1,
      deactivated: 0,
      deduplicated: 1,
      failed: 0,
    });

    const result = await refreshRecurringForUser("user-1");

    expect(result).toEqual({
      plaid: 0,
      inferred: { active: 2, added: 1, deactivated: 0, deduplicated: 1, failed: 0 },
    });
    expect(mockServiceClient.from).not.toHaveBeenCalled();
    expect(mockRefreshInferredRecurringForUser).toHaveBeenCalledWith("user-1");
    expect(mockLogError).toHaveBeenCalledWith("recurring.item", expect.any(Error));
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

describe("lib/recurring stored-read failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshInferredRecurringForUser.mockResolvedValue({
      active: 0,
      added: 0,
      deactivated: 0,
      deduplicated: 0,
      failed: 0,
    });
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

  function plaidResponse(streamIds: string[], amount: number) {
    return {
      data: {
        inflow_streams: [],
        outflow_streams: streamIds.map((streamId) => ({
          stream_id: streamId,
          merchant_name: "Netflix",
          description: "Netflix Subscription",
          average_amount: { amount },
          last_amount: { amount },
          frequency: "MONTHLY",
          status: "MATURE",
          personal_finance_category: { primary: "ENTERTAINMENT" },
          is_active: true,
          account_id: "plaid-acct-1",
          transaction_ids: [],
        })),
      },
    };
  }

  it("throws when the stored plaid snapshot read fails", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce(plaidResponse(["stream-1"], 15.99));
    const mock = createRecurringSupabaseMock({
      accounts: { data: [{ id: "local-acct-1", plaid_account_id: "plaid-acct-1" }], error: null },
      existingStreams: { data: [], error: { message: "plaid snapshot read failed" } },
    });
    mockServiceClient.from.mockImplementation(mock.from);
    mockServiceClient.rpc = mock.rpc;

    await expect(refreshRecurringForItem(dummyItem)).rejects.toMatchObject({
      message: "plaid snapshot read failed",
    });
  });

  it("throws when the stored inferred identity read fails", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce(plaidResponse(["stream-1"], 15.99));
    const mock = createRecurringSupabaseMock({
      accounts: { data: [{ id: "local-acct-1", plaid_account_id: "plaid-acct-1" }], error: null },
      existingStreams: { data: [], error: null },
    });
    // The module's second recurring_streams read (inferred identities) runs
    // after the plaid snapshot read resolves fine.
    let recurringStreamsReads = 0;
    const originalFrom = mock.from;
    mockServiceClient.from.mockImplementation((table: string) => {
      const builder = originalFrom(table);
      if (table === "recurring_streams") {
        recurringStreamsReads += 1;
        if (recurringStreamsReads === 2) {
          return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: { message: "inferred read failed" } }) }) }) }) }) };
        }
      }
      return builder;
    });
    mockServiceClient.rpc = mock.rpc;

    await expect(refreshRecurringForItem(dummyItem)).rejects.toMatchObject({
      message: "inferred read failed",
    });
  });
});

describe("lib/recurring snapshot and notification edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshInferredRecurringForUser.mockResolvedValue({
      active: 0,
      added: 0,
      deactivated: 0,
      deduplicated: 0,
      failed: 0,
    });
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

  function plaidResponse(streamIds: string[], amount: number) {
    return {
      data: {
        inflow_streams: [],
        outflow_streams: streamIds.map((streamId) => ({
          stream_id: streamId,
          merchant_name: "Netflix",
          description: "Netflix Subscription",
          average_amount: { amount },
          last_amount: { amount },
          frequency: "MONTHLY",
          status: "MATURE",
          personal_finance_category: { primary: "ENTERTAINMENT" },
          is_active: true,
          account_id: "plaid-acct-1",
          transaction_ids: [],
        })),
      },
    };
  }

  it("falls back to the row count when the atomic writer returns no usable count", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce(plaidResponse(["stream-1"], 15.99));
    const mock = createRecurringSupabaseMock({
      existingStreams: { data: [], error: null },
      upserted: { data: [{ id: "row-1", stream_id: "stream-1" }], error: null },
    });
    mock.rpc.mockResolvedValueOnce({ data: { plaid: "not-a-number" }, error: null });
    mockServiceClient.from.mockImplementation(mock.from);
    mockServiceClient.rpc = mock.rpc;

    const count = await refreshRecurringForItem(dummyItem);
    expect(count).toBe(1);
  });

  it("uses a numeric count from the atomic writer verbatim", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce(plaidResponse(["stream-1"], 15.99));
    const mock = createRecurringSupabaseMock({
      existingStreams: { data: [], error: null },
      upserted: { data: [{ id: "row-1", stream_id: "stream-1" }], error: null },
    });
    mock.rpc.mockResolvedValueOnce({ data: 7, error: null });
    mockServiceClient.from.mockImplementation(mock.from);
    mockServiceClient.rpc = mock.rpc;

    const count = await refreshRecurringForItem(dummyItem);
    expect(count).toBe(7);
  });

  it("does not double-notify when two provider streams share one identity", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce(plaidResponse(["stream-a", "stream-b"], 19.99));
    const mock = createRecurringSupabaseMock({
      accounts: { data: [{ id: "local-acct-1", plaid_account_id: "plaid-acct-1" }], error: null },
      existingStreams: {
        data: [
          { stream_id: "stream-a", last_amount: 10 },
          { stream_id: "stream-b", last_amount: 10 },
        ],
        error: null,
      },
      upserted: {
        data: [
          { id: "row-a", stream_id: "stream-a" },
          { id: "row-b", stream_id: "stream-b" },
        ],
        error: null,
      },
    });
    mockServiceClient.from.mockImplementation(mock.from);
    mockServiceClient.rpc = mock.rpc;

    await refreshRecurringForItem(dummyItem);
    const hikes = mockCreateNotification.mock.calls.filter((call) => call[1] === "price_hike");
    expect(hikes).toHaveLength(1);
  });

  it("notifies each identical-identity new stream only once", async () => {
    mockTransactionsRecurringGet.mockResolvedValueOnce(plaidResponse(["stream-a", "stream-b"], 9.99));
    const mock = createRecurringSupabaseMock({
      accounts: { data: [{ id: "local-acct-1", plaid_account_id: "plaid-acct-1" }], error: null },
      // A pre-existing unrelated stream is required for the diff to run at
      // all: the first refresh seeds silently instead of announcing every
      // pre-existing subscription as new.
      existingStreams: { data: [{ stream_id: "stream-old", last_amount: 5 }], error: null },
      upserted: {
        data: [
          { id: "row-old", stream_id: "stream-old" },
          { id: "row-a", stream_id: "stream-a" },
          { id: "row-b", stream_id: "stream-b" },
        ],
        error: null,
      },
    });
    mockServiceClient.from.mockImplementation(mock.from);
    mockServiceClient.rpc = mock.rpc;

    await refreshRecurringForItem(dummyItem);
    const fresh = mockCreateNotification.mock.calls.filter((call) => call[1] === "new_subscription");
    expect(fresh).toHaveLength(1);
  });
});
