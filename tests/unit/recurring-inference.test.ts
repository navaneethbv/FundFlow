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
  const seenIdentities = new Set<string>();
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ table: name, method: "rpc", args: [args] });
    const payload = args.p_payload as { candidates?: unknown[]; deduplications?: unknown[] };
    const candidates = payload.candidates ?? [];
    const added = candidates.filter((candidate) => {
      const identity = String((candidate as Row).identity_key ?? "");
      if (seenIdentities.has(identity)) return false;
      seenIdentities.add(identity);
      return true;
    }).length;
    return {
      data: {
        active: candidates.length,
        added,
        deactivated: 0,
        deduplicated: payload.deduplications?.length ?? 0,
        failed: 0,
      },
      error: null,
    };
  });
  const from = vi.fn((table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let range: [number, number] | null = null;
    let selected = "*";
    let operation: { method: "insert" | "update" | "delete"; values?: unknown } | null = null;
    const query = {} as Record<string, unknown>;
    query.select = (...args: unknown[]) => {
        selected = String(args[0] ?? "*");
        calls.push({ table, method: "select", args });
        return query;
      };
    query.insert = (...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        operation = { method: "insert", values: args[0] };
        return query;
      };
    query.update = (...args: unknown[]) => {
        calls.push({ table, method: "update", args });
        operation = { method: "update", values: args[0] ?? {} };
        return query;
      };
    query.delete = (...args: unknown[]) => {
        calls.push({ table, method: "delete", args });
        operation = { method: "delete" };
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
        const allRows = tables.get(table) ?? [];
        const matchedRows = allRows.filter((row) => filters.every((filter) => filter(row)));
        if (operation?.method === "insert") {
          const values = Array.isArray(operation.values) ? operation.values : [operation.values];
          allRows.push(...values.map((value) => ({ ...(value as Row), id: (value as Row).id ?? `${table}-${allRows.length + 1}` })));
          tables.set(table, allRows);
        } else if (operation?.method === "update") {
          for (const row of matchedRows) Object.assign(row, operation.values as Row);
        } else if (operation?.method === "delete") {
          tables.set(table, allRows.filter((row) => !matchedRows.includes(row)));
        }
        operation = null;
        let rows = (tables.get(table) ?? []).filter((row) => filters.every((filter) => filter(row)));
        if (range) rows = rows.slice(range[0], range[1] + 1);
        const data = selected.includes("id,stream_id") || selected.includes("id") ? rows : rows;
        return resolve({ data: data.length === 1 && calls.at(-1)?.method === "maybeSingle" ? data[0] ?? null : data, error: null });
    };
    return query;
  });
  return { from, rpc, tables, calls };
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

  it("pages raw metadata in stable 1,000-row windows", async () => {
    const metadata = Array.from({ length: 1001 }, (_, index) => ({
      id: `txn-${index}`,
      user_id: "user-1",
      account_id: "acct-1",
      date: "2026-07-15",
      authorized_date: null,
      amount: 1,
      merchant_name: "One-off",
      name: "ONE-OFF",
      pfc_primary: "GENERAL_MERCHANDISE",
      pfc_detailed: "OTHER",
      payment_channel: "online",
      iso_currency_code: "USD",
      pending: false,
    }));
    mockLoadCanonicalProjection.mockResolvedValue({ transactions: [], currencyByAccountId: new Map(), truncated: false });
    mockServiceClient = makeQueryClient({
      accounts: [{ id: "acct-1", user_id: "user-1", plaid_item_id: "item-1" }],
      transactions: metadata,
      recurring_streams: [],
      recurring_stream_transactions: [],
    });

    await refreshInferredRecurringForItem(item(), { today: "2026-08-30" });
    expect(mockServiceClient.calls.filter((call) => call.table === "transactions" && call.method === "range").map((call) => call.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
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
    expect(result).toEqual({ active: 1, added: 1, deactivated: 0, deduplicated: 0, failed: 0 });
    expect(mockServiceClient.rpc).toHaveBeenCalledWith("reconcile_inferred_recurring", expect.objectContaining({
      p_user_id: "user-1",
      p_item_id: "item-1",
      p_payload: expect.objectContaining({
        candidates: [expect.objectContaining({
          expected_amount: 15,
          transaction_ids: ["txn-1", "txn-2", "txn-3"],
          detection_evidence: expect.objectContaining({ occurrenceCount: 3 }),
        })],
      }),
    }));
    expect(mockServiceClient.calls.some((call) => ["insert", "update", "delete"].includes(call.method))).toBe(false);

    mockLoadCanonicalProjection.mockResolvedValue(monthlyProjection());
    const rerun = await refreshInferredRecurringForItem(item(), { today: "2026-08-30" });
    expect(rerun.added).toBe(0);
    expect(mockServiceClient.rpc).toHaveBeenCalledTimes(2);
  });

  it("uses the detector expected amount and collapses split canonical rows to one source transaction", async () => {
    mockLoadCanonicalProjection.mockResolvedValue({
      transactions: [
        ...monthlyProjection().transactions.flatMap((transaction) => [transaction, { ...transaction, id: `${transaction.id}::1`, categoryKey: "SPLIT" }]),
      ],
      currencyByAccountId: new Map([["acct-1", "USD"]]),
      truncated: false,
    });
    mockServiceClient = makeQueryClient({
      accounts: [{ id: "acct-1", user_id: "user-1", plaid_item_id: "item-1" }],
      transactions: [
        { id: "txn-1", user_id: "user-1", account_id: "acct-1", date: "2026-05-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
        { id: "txn-2", user_id: "user-1", account_id: "acct-1", date: "2026-06-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
        { id: "txn-3", user_id: "user-1", account_id: "acct-1", date: "2026-07-15", authorized_date: null, amount: 18, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
      ],
      recurring_streams: [],
      recurring_stream_transactions: [],
    });

    await refreshInferredRecurringForItem(item(), { today: "2026-08-30" });
    const payload = mockServiceClient.rpc.mock.calls[0]?.[1] as { p_payload: { candidates: Array<Record<string, unknown>> } };
    expect(payload.p_payload.candidates[0]).toMatchObject({ expected_amount: 18, transaction_ids: ["txn-1", "txn-2", "txn-3"] });
  });

  it("does not let an inactive Plaid stream suppress a fresh inferred candidate", async () => {
    mockServiceClient = makeQueryClient({
      accounts: [{ id: "acct-1", user_id: "user-1", plaid_item_id: "item-1" }],
      transactions: [
        { id: "txn-1", user_id: "user-1", account_id: "acct-1", date: "2026-05-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
        { id: "txn-2", user_id: "user-1", account_id: "acct-1", date: "2026-06-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
        { id: "txn-3", user_id: "user-1", account_id: "acct-1", date: "2026-07-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
      ],
      recurring_streams: [{
        id: "plaid-inactive",
        user_id: "user-1",
        plaid_item_id: "item-1",
        stream_id: "plaid-inactive",
        source: "plaid",
        identity_key: recurringIdentityKey("user-1", "acct-1", "outflow", "Streaming Co", "MONTHLY"),
        stream_type: "outflow",
        merchant_name: "Streaming Co",
        frequency: "MONTHLY",
        account_id: "acct-1",
        is_active: false,
      }],
      recurring_stream_transactions: [],
    });

    await refreshInferredRecurringForItem(item(), { today: "2026-08-30" });

    const payload = mockServiceClient.calls.find((call) => call.method === "rpc")?.args[0] as { p_payload: { candidates: unknown[]; deduplications: unknown[] } };
    expect(payload.p_payload.candidates).toHaveLength(1);
    expect(payload.p_payload.deduplications).toEqual([]);
    expect(mockServiceClient.calls.some((call) => call.table === "recurring_streams" && call.method === "eq" && call.args[0] === "is_active" && call.args[1] === true)).toBe(true);
  });

  it("retains successful item counts and reports failed item refreshes", async () => {
    const first = item({ id: "item-1" });
    const second = item({ id: "item-2" });
    mockListActiveItems.mockResolvedValue([first, second]);
    mockServiceClient = makeQueryClient({
      accounts: [
        { id: "acct-1", user_id: "user-1", plaid_item_id: "item-1" },
        { id: "acct-2", user_id: "user-1", plaid_item_id: "item-2" },
      ],
      transactions: [],
      recurring_streams: [],
      recurring_stream_transactions: [],
    });
    mockServiceClient.rpc.mockRejectedValueOnce(new Error("second item failed"));
    mockServiceClient.rpc.mockResolvedValueOnce({ data: { active: 0, added: 0, deactivated: 0, deduplicated: 0, failed: 0 }, error: null });

    const result = await refreshInferredRecurringForUser("user-1", { today: "2026-08-30" });

    expect(result).toMatchObject({ active: 0, added: 0, deactivated: 0, deduplicated: 0, failed: 1 });
  });

  it("detects imported connected-account rows while excluding canonical transfers, refunds, and manual-only rows", async () => {
    const imported = [
      { id: "import-1::0", sourceTransactionId: "import-1", date: "2026-05-15", signedAmount: 15, flow: "expense" as const, merchant: "Imported Subscription", groupKey: "ENTERTAINMENT", categoryKey: "STREAMING", accountId: "acct-1", manualAccountId: null, pending: false, source: "import" as const },
      { id: "import-1::1", sourceTransactionId: "import-1", date: "2026-05-15", signedAmount: 0, flow: "expense" as const, merchant: "Imported Subscription", groupKey: "ENTERTAINMENT", categoryKey: "STREAMING", accountId: "acct-1", manualAccountId: null, pending: false, source: "import" as const },
      { id: "import-2", sourceTransactionId: "import-2", date: "2026-06-15", signedAmount: 15, flow: "expense" as const, merchant: "Imported Subscription", groupKey: "ENTERTAINMENT", categoryKey: "STREAMING", accountId: "acct-1", manualAccountId: null, pending: false, source: "import" as const },
      { id: "import-3", sourceTransactionId: "import-3", date: "2026-07-15", signedAmount: 15, flow: "expense" as const, merchant: "Imported Subscription", groupKey: "ENTERTAINMENT", categoryKey: "STREAMING", accountId: "acct-1", manualAccountId: null, pending: false, source: "import" as const },
      { id: "transfer-1", sourceTransactionId: "transfer-1", date: "2026-05-15", signedAmount: 15, flow: "transfer" as const, merchant: "Imported Subscription", groupKey: "TRANSFER_OUT", categoryKey: "TRANSFER_OUT", accountId: "acct-1", manualAccountId: null, pending: false, source: "plaid" as const },
      { id: "refund-1", sourceTransactionId: "refund-1", date: "2026-06-15", signedAmount: -15, flow: "transfer" as const, merchant: "Imported Subscription", groupKey: "ENTERTAINMENT", categoryKey: "STREAMING", accountId: "acct-1", manualAccountId: null, pending: false, source: "plaid" as const },
      { id: "manual-1", sourceTransactionId: "manual-1", date: "2026-07-15", signedAmount: 15, flow: "expense" as const, merchant: "Imported Subscription", groupKey: "ENTERTAINMENT", categoryKey: "STREAMING", accountId: null, manualAccountId: "manual-acct-1", pending: false, source: "manual" as const },
    ];
    mockLoadCanonicalProjection.mockResolvedValue({
      transactions: imported,
      currencyByAccountId: new Map([["acct-1", "USD"]]),
      truncated: false,
    });
    mockServiceClient = makeQueryClient({
      accounts: [{ id: "acct-1", user_id: "user-1", plaid_item_id: "item-1" }],
      transactions: [
        ["import-1", "2026-05-15"],
        ["import-2", "2026-06-15"],
        ["import-3", "2026-07-15"],
        ["transfer-1", "2026-05-15"],
        ["refund-1", "2026-06-15"],
        ["manual-1", "2026-07-15"],
        ["absent-duplicate", "2026-07-15"],
      ].map(([id, date]) => ({
        id,
        user_id: "user-1",
        account_id: "acct-1",
        date,
        authorized_date: null,
        amount: 15,
        merchant_name: "Imported Subscription",
        name: "IMPORTED SUBSCRIPTION",
        pfc_primary: "ENTERTAINMENT",
        pfc_detailed: "STREAMING",
        payment_channel: "online",
        iso_currency_code: "USD",
        pending: false,
      })),
      recurring_streams: [],
      recurring_stream_transactions: [],
    });

    await refreshInferredRecurringForItem(item(), { today: "2026-08-30" });
    const payload = mockServiceClient.rpc.mock.calls[0]?.[1] as { p_payload: { candidates: Array<Record<string, unknown>> } };
    expect(payload.p_payload.candidates).toHaveLength(1);
    expect(payload.p_payload.candidates[0]).toMatchObject({
      transaction_ids: ["import-1", "import-2", "import-3"],
    });
    expect(payload.p_payload.candidates[0]?.transaction_ids).not.toContain("absent-duplicate");
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
    expect(result).toMatchObject({ active: 0, added: 0, deactivated: 0, deduplicated: 1 });
    const rpcPayload = mockServiceClient.rpc.mock.calls[0]?.[1] as { p_payload: { candidates: unknown[]; deduplications: unknown[] } };
    expect(rpcPayload.p_payload.candidates).toEqual([]);
    expect(rpcPayload.p_payload.deduplications).toEqual([{ plaid_id: "plaid-db", inferred_id: "inferred-db" }]);
    expect(mockServiceClient.calls.some((call) => ["insert", "update", "delete"].includes(call.method))).toBe(false);
  });

  it("prioritizes any transaction overlap over an earlier identity-only Plaid match", async () => {
    mockServiceClient = makeQueryClient({
      accounts: [{ id: "acct-1", user_id: "user-1", plaid_item_id: "item-1" }],
      transactions: [
        { id: "txn-1", user_id: "user-1", account_id: "acct-1", date: "2026-05-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
        { id: "txn-2", user_id: "user-1", account_id: "acct-1", date: "2026-06-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
        { id: "txn-3", user_id: "user-1", account_id: "acct-1", date: "2026-07-15", authorized_date: null, amount: 15, merchant_name: "Streaming Co", name: "STREAMING CO", pfc_primary: "ENTERTAINMENT", pfc_detailed: "STREAMING", payment_channel: "online", iso_currency_code: "USD", pending: false },
      ],
      recurring_streams: [
        { id: "plaid-identity", user_id: "user-1", plaid_item_id: "item-1", stream_id: "plaid-identity-stream", source: "plaid", stream_type: "outflow", merchant_name: "Streaming Co", frequency: "MONTHLY", account_id: "acct-1", is_active: true },
        { id: "plaid-overlap", user_id: "user-1", plaid_item_id: "item-1", stream_id: "plaid-overlap-stream", source: "plaid", stream_type: "outflow", merchant_name: "Different Label", frequency: "MONTHLY", account_id: "acct-1", is_active: true },
      ],
      recurring_stream_transactions: [{ recurring_stream_id: "plaid-overlap", transaction_id: "txn-1", user_id: "user-1" }],
    });

    await refreshInferredRecurringForItem(item(), { today: "2026-08-30" });
    const payload = mockServiceClient.rpc.mock.calls[0]?.[1] as { p_payload: { deduplications: unknown[] } };
    expect(payload.p_payload.deduplications).toEqual([{ plaid_id: "plaid-overlap", inferred_id: "" }]);
  });

  it("does not call the atomic writer for a truncated canonical projection", async () => {
    mockLoadCanonicalProjection.mockResolvedValue({ transactions: [], currencyByAccountId: new Map(), truncated: true });
    mockServiceClient = makeQueryClient({ accounts: [], transactions: [], recurring_streams: [], recurring_stream_transactions: [] });
    await expect(refreshInferredRecurringForItem(item(), { today: "2026-08-30" })).rejects.toThrow("recurring_projection_truncated");
    expect(mockServiceClient.rpc).not.toHaveBeenCalled();
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
    expect(result).toMatchObject({ active: 0, added: 0, deactivated: 0, deduplicated: 0 });
    expect(mockServiceClient.rpc).toHaveBeenCalledWith("reconcile_inferred_recurring", expect.objectContaining({
      p_payload: { candidates: [], deduplications: [] },
    }));
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
