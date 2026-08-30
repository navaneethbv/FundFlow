import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadCanonicalProjection = vi.fn();
vi.mock("@/lib/finance-query", () => ({
  loadCanonicalProjection: (...args: unknown[]) => mockLoadCanonicalProjection(...args),
}));

let mockServiceClient: ReturnType<typeof makeQueryClient>;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockListActiveItems = vi.fn();
vi.mock("@/lib/plaid-service", () => ({
  listActiveItems: (...args: unknown[]) => mockListActiveItems(...args),
}));

import type { PlaidItemRow } from "@/lib/types";
import {
  refreshInferredRecurringForItem,
  refreshInferredRecurringForUser,
} from "@/lib/recurring-inference";
import { recurringIdentityKey } from "@/lib/recurring-detection";

type Row = Record<string, unknown>;

function makeQueryClient(seed: Record<string, Row[]> = {}) {
  const tables = new Map(Object.entries(seed).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]));
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const from = vi.fn((table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let range: [number, number] | null = null;
    let selected = "*";
    const query = {} as Record<string, unknown>;
    query.select = (...args: unknown[]) => {
        selected = String(args[0] ?? "*");
        calls.push({ table, method: "select", args });
        return query;
      };
    query.insert = (...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        const values = Array.isArray(args[0]) ? args[0] : [args[0]];
        const rows = tables.get(table) ?? [];
        rows.push(...values.map((value) => ({ ...(value as Row), id: (value as Row).id ?? `${table}-${rows.length + 1}` })));
        tables.set(table, rows);
        return query;
      };
    query.update = (...args: unknown[]) => {
        calls.push({ table, method: "update", args });
        const values = (args[0] ?? {}) as Row;
        const rows = tables.get(table) ?? [];
        for (const row of rows) if (filters.every((filter) => filter(row))) Object.assign(row, values);
        return query;
      };
    query.delete = (...args: unknown[]) => {
        calls.push({ table, method: "delete", args });
        const rows = tables.get(table) ?? [];
        tables.set(table, rows.filter((row) => !filters.every((filter) => filter(row))));
        return query;
      };
    query.eq = (...args: unknown[]) => {
        calls.push({ table, method: "eq", args });
        filters.push((row) => row[String(args[0])] === args[1]);
        return query;
      };
    query.in = (...args: unknown[]) => {
        calls.push({ table, method: "in", args });
        const values = new Set(args[1] as unknown[]);
        filters.push((row) => values.has(row[String(args[0])]));
        return query;
      };
    query.gte = (...args: unknown[]) => {
        calls.push({ table, method: "gte", args });
        filters.push((row) => String(row[String(args[0])] ?? "") >= String(args[1]));
        return query;
      };
    query.lt = (...args: unknown[]) => {
        calls.push({ table, method: "lt", args });
        filters.push((row) => String(row[String(args[0])] ?? "") < String(args[1]));
        return query;
      };
    query.order = (...args: unknown[]) => {
        calls.push({ table, method: "order", args });
        return query;
      };
    query.range = (...args: unknown[]) => {
        calls.push({ table, method: "range", args });
        range = [Number(args[0]), Number(args[1])];
        return query;
      };
    query.maybeSingle = (...args: unknown[]) => {
        calls.push({ table, method: "maybeSingle", args });
        return query;
      };
    query.single = (...args: unknown[]) => {
        calls.push({ table, method: "single", args });
        return query;
      };
    query.then = (resolve: (value: unknown) => unknown) => {
        let rows = (tables.get(table) ?? []).filter((row) => filters.every((filter) => filter(row)));
        if (range) rows = rows.slice(range[0], range[1] + 1);
        const data = selected.includes("id,stream_id") || selected.includes("id") ? rows : rows;
        return resolve({ data: data.length === 1 && calls.at(-1)?.method === "maybeSingle" ? data[0] ?? null : data, error: null });
    };
    return query;
  });
  return { from, tables, calls };
}

function item(overrides: Partial<PlaidItemRow> = {}): PlaidItemRow {
  return {
    id: "item-1",
    user_id: "user-1",
    plaid_item_id: "plaid-item-1",
    institution_id: null,
    institution_name: "Test Bank",
    access_token_ciphertext: "cipher",
    access_token_iv: "iv",
    access_token_tag: "tag",
    sync_cursor: null,
    status: "active",
    error_code: null,
    ...overrides,
  };
}

function monthlyProjection() {
  return {
    transactions: [
      { id: "txn-1", sourceTransactionId: "txn-1", date: "2026-05-15", signedAmount: 15, flow: "expense", merchant: "Streaming Co", groupKey: "ENTERTAINMENT", categoryKey: "STREAMING", accountId: "acct-1", manualAccountId: null, pending: false, source: "plaid" },
      { id: "txn-2", sourceTransactionId: "txn-2", date: "2026-06-15", signedAmount: 15, flow: "expense", merchant: "Streaming Co", groupKey: "ENTERTAINMENT", categoryKey: "STREAMING", accountId: "acct-1", manualAccountId: null, pending: false, source: "plaid" },
      { id: "txn-3", sourceTransactionId: "txn-3", date: "2026-07-15", signedAmount: 15, flow: "expense", merchant: "Streaming Co", groupKey: "ENTERTAINMENT", categoryKey: "STREAMING", accountId: "acct-1", manualAccountId: null, pending: false, source: "import" },
    ],
    currencyByAccountId: new Map([["acct-1", "USD"]]),
    truncated: false,
  };
}

describe("recurring inference reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListActiveItems.mockResolvedValue([item()]);
    mockLoadCanonicalProjection.mockResolvedValue(monthlyProjection());
  });

  it("loads a bounded canonical item projection and raw metadata with owner, account, pending, date, order, and range scope", async () => {
    mockServiceClient = makeQueryClient({
      accounts: [{ id: "acct-1", user_id: "user-1", plaid_item_id: "item-1" }],
      transactions: [
        { id: "txn-1", user_id: "user-1", account_id: "acct-1", date: "2026-05-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
        { id: "txn-2", user_id: "user-1", account_id: "acct-1", date: "2026-06-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
        { id: "txn-3", user_id: "user-1", account_id: "acct-1", date: "2026-07-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
      ],
      recurring_streams: [],
      recurring_stream_transactions: [],
    });

    await refreshInferredRecurringForItem(item(), { today: "2026-08-30" });

    expect(mockLoadCanonicalProjection).toHaveBeenCalledWith(
      mockServiceClient,
      expect.objectContaining({
        scope: { kind: "mine", ownerUserId: "user-1" },
        excludePending: true,
        window: { start: "2025-11-01", endExclusive: "2026-09-01" },
      }),
    );
    const accountCalls = mockServiceClient.calls.filter((call) => call.table === "accounts");
    expect(accountCalls.some((call) => call.method === "eq" && call.args[0] === "user_id" && call.args[1] === "user-1")).toBe(true);
    expect(accountCalls.some((call) => call.method === "eq" && call.args[0] === "plaid_item_id" && call.args[1] === "item-1")).toBe(true);
    const transactionCalls = mockServiceClient.calls.filter((call) => call.table === "transactions");
    expect(transactionCalls.some((call) => call.method === "eq" && call.args[0] === "user_id" && call.args[1] === "user-1")).toBe(true);
    expect(transactionCalls.some((call) => call.method === "in" && call.args[0] === "account_id" && Array.isArray(call.args[1]) && call.args[1].includes("acct-1"))).toBe(true);
    expect(transactionCalls.some((call) => call.method === "eq" && call.args[0] === "pending" && call.args[1] === false)).toBe(true);
    expect(transactionCalls.some((call) => call.method === "gte" && call.args[0] === "date" && call.args[1] === "2025-11-01")).toBe(true);
    expect(transactionCalls.some((call) => call.method === "lt" && call.args[0] === "date" && call.args[1] === "2026-09-01")).toBe(true);
    expect(transactionCalls.filter((call) => call.method === "order").map((call) => call.args[0])).toEqual(["date", "id"]);
    expect(transactionCalls.some((call) => call.method === "range" && call.args[0] === 0 && call.args[1] === 999)).toBe(true);
  });

  it("persists a mature stream and exact canonical transaction joins, then remains idempotent", async () => {
    mockServiceClient = makeQueryClient({
      accounts: [{ id: "acct-1", user_id: "user-1", plaid_item_id: "item-1" }],
      transactions: [
        { id: "txn-1", user_id: "user-1", account_id: "acct-1", date: "2026-05-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
        { id: "txn-2", user_id: "user-1", account_id: "acct-1", date: "2026-06-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
        { id: "txn-3", user_id: "user-1", account_id: "acct-1", date: "2026-07-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
      ],
      recurring_streams: [],
      recurring_stream_transactions: [],
    });

    const result = await refreshInferredRecurringForItem(item(), { today: "2026-08-30" });
    expect(result).toEqual({ active: 1, added: 1, deactivated: 0, deduplicated: 0 });
    const persisted = mockServiceClient.tables.get("recurring_streams")?.[0];
    expect(persisted).toMatchObject({ source: "inferred", status: "MATURE", detection_version: 1, is_active: true });
    expect(persisted?.stream_id).toMatch(/^inferred:[a-f0-9]+$/u);
    expect(persisted?.detection_evidence).toMatchObject({ occurrenceCount: 3 });
    expect(persisted).not.toHaveProperty("reviewed_at");
    expect(mockServiceClient.tables.get("recurring_stream_transactions")?.map((row) => row.transaction_id)).toEqual(["txn-1", "txn-2", "txn-3"]);

    mockLoadCanonicalProjection.mockResolvedValue(monthlyProjection());
    const rerun = await refreshInferredRecurringForItem(item(), { today: "2026-08-30" });
    expect(rerun.added).toBe(0);
    expect(mockServiceClient.tables.get("recurring_streams")).toHaveLength(1);
  });

  it("refreshes every active item for a user", async () => {
    const second = item({ id: "item-2" });
    mockListActiveItems.mockResolvedValue([item(), second]);
    mockServiceClient = makeQueryClient({ accounts: [], transactions: [], recurring_streams: [], recurring_stream_transactions: [] });
    await refreshInferredRecurringForUser("user-1", { today: "2026-08-30" });
    expect(mockListActiveItems).toHaveBeenCalledWith("user-1");
    expect(mockLoadCanonicalProjection).toHaveBeenCalledTimes(2);
  });

  it("lets Plaid win by transaction overlap, transfers only missing user state, and deactivates the inferred row", async () => {
    const identityKey = recurringIdentityKey("user-1", "acct-1", "outflow", "Streaming Co", "MONTHLY");
    mockServiceClient = makeQueryClient({
      accounts: [{ id: "acct-1", user_id: "user-1", plaid_item_id: "item-1" }],
      transactions: [
        { id: "txn-1", user_id: "user-1", account_id: "acct-1", date: "2026-05-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
        { id: "txn-2", user_id: "user-1", account_id: "acct-1", date: "2026-06-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
        { id: "txn-3", user_id: "user-1", account_id: "acct-1", date: "2026-07-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
      ],
      recurring_streams: [
        { id: "plaid-db", user_id: "user-1", plaid_item_id: "item-1", stream_id: "plaid-stream", source: "plaid", stream_type: "outflow", merchant_name: "Streaming Co", description: null, frequency: "MONTHLY", account_id: "acct-1", is_active: true, reviewed_at: null, dismissed_at: "2026-01-02T00:00:00Z", user_amount: null },
        { id: "inferred-db", user_id: "user-1", plaid_item_id: "item-1", stream_id: "inferred:old", source: "inferred", identity_key: identityKey, stream_type: "outflow", merchant_name: "Streaming Co", description: "Streaming Co", frequency: "MONTHLY", account_id: "acct-1", is_active: true, reviewed_at: "2026-02-01T00:00:00Z", dismissed_at: "2026-02-02T00:00:00Z", user_amount: 17 },
      ],
      recurring_stream_transactions: [{ recurring_stream_id: "plaid-db", transaction_id: "txn-1", user_id: "user-1" }],
    });

    const result = await refreshInferredRecurringForItem(item(), { today: "2026-08-30" });
    expect(result).toMatchObject({ active: 0, added: 0, deactivated: 1, deduplicated: 1 });
    const streams = mockServiceClient.tables.get("recurring_streams") ?? [];
    expect(streams.find((row) => row.id === "plaid-db")).toMatchObject({
      reviewed_at: "2026-02-01T00:00:00Z",
      dismissed_at: "2026-01-02T00:00:00Z",
      user_amount: 17,
    });
    expect(streams.find((row) => row.id === "inferred-db")).toMatchObject({ is_active: false });
    const inferredUpdates = mockServiceClient.calls.filter(
      (call) => call.table === "recurring_streams" && call.method === "update" && (call.args[0] as Row).is_active === false,
    );
    expect(inferredUpdates).toHaveLength(1);
  });

  it("marks only stale inferred rows for the requested item after a complete empty pass", async () => {
    mockLoadCanonicalProjection.mockResolvedValue({ transactions: [], currencyByAccountId: new Map(), truncated: false });
    mockServiceClient = makeQueryClient({
      accounts: [{ id: "acct-1", user_id: "user-1", plaid_item_id: "item-1" }],
      transactions: [],
      recurring_streams: [{ id: "stale-db", user_id: "user-1", plaid_item_id: "item-1", stream_id: "inferred:stale", source: "inferred", is_active: true }],
      recurring_stream_transactions: [],
    });

    const result = await refreshInferredRecurringForItem(item(), { today: "2026-08-30" });
    expect(result).toMatchObject({ active: 0, added: 0, deactivated: 1, deduplicated: 0 });
    expect(mockServiceClient.tables.get("recurring_streams")?.[0]).toMatchObject({ is_active: false });
    const update = mockServiceClient.calls.find((call) => call.table === "recurring_streams" && call.method === "update");
    expect(update?.args[0]).toEqual({ is_active: false });
    expect(mockServiceClient.calls.filter((call) => call.table === "recurring_streams" && call.method === "eq").map((call) => call.args)).toEqual(
      expect.arrayContaining([["user_id", "user-1"], ["plaid_item_id", "item-1"], ["source", "inferred"]]),
    );
  });

  it("does not mark or mutate inferred rows when canonical loading fails", async () => {
    mockLoadCanonicalProjection.mockRejectedValue(new Error("projection failed"));
    mockServiceClient = makeQueryClient({
      accounts: [{ id: "acct-1", user_id: "user-1", plaid_item_id: "item-1" }],
      transactions: [],
      recurring_streams: [{ id: "stale-db", user_id: "user-1", plaid_item_id: "item-1", stream_id: "inferred:stale", source: "inferred", is_active: true }],
      recurring_stream_transactions: [],
    });

    await expect(refreshInferredRecurringForItem(item(), { today: "2026-08-30" })).rejects.toThrow("projection failed");
    expect(mockServiceClient.tables.get("recurring_streams")?.[0]).toMatchObject({ is_active: true });
    expect(mockServiceClient.calls.some((call) => call.table === "recurring_streams" && call.method === "update")).toBe(false);
  });
});
