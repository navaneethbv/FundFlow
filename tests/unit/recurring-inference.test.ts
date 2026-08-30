import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockLoadCanonicalProjection = vi.fn();
vi.mock("@/lib/finance-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance-query")>()),
  loadCanonicalProjection: (...args: unknown[]) => mockLoadCanonicalProjection(...args),
}));

const mockListActiveItems = vi.fn();
vi.mock("@/lib/plaid-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plaid-service")>()),
  listActiveItems: (...args: unknown[]) => mockListActiveItems(...args),
}));

const clientRef = vi.hoisted(() => ({ current: null as { from: (table: string) => unknown } }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => clientRef.current,
}));

import {
  refreshInferredRecurringForItem,
  refreshInferredRecurringForUser,
} from "@/lib/recurring-inference";
import { recurringIdentityKey, normalizeRecurringMerchant } from "@/lib/recurring-detection";
import type { PlaidItemRow } from "@/lib/types";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

const TODAY = "2026-09-01";

type FilterCall = { method: string; args: unknown[] };

interface TableSpec {
  rows?: Record<string, unknown>[];
  /** Resolved as the operation's error when it returns one. */
  fail?: (calls: FilterCall[], operation: string, attempt: number) => unknown;
}

interface MockClient {
  from: (table: string) => unknown;
  callsOn: (table: string) => FilterCall[];
  rowsOf: (table: string) => Record<string, unknown>[];
}

/**
 * Minimal fluent Supabase mock that actually applies eq/in/gte/lt filters to
 * seeded rows, so recurring_streams reads with different `source` filters
 * resolve differently within one test. Mutations apply to the shared table
 * rows, so later queries observe earlier writes.
 */
function createMockClient(tables: Record<string, TableSpec>): MockClient {
  const state = new Map<string, { rows: Record<string, unknown>[]; calls: FilterCall[] }>();
  let nextRowId = 1;
  const tableState = (table: string) => {
    let entry = state.get(table);
    if (!entry) {
      entry = { rows: [...(tables[table]?.rows ?? [])], calls: [] };
      state.set(table, entry);
    }
    return entry;
  };

  function buildQuery(table: string) {
    const shared = tableState(table);
    const calls: FilterCall[] = [];
    const recordCalls = (list: FilterCall[]) => {
      calls.push(...list);
      shared.calls.push(...list);
    };
    let working = [...shared.rows];
    let operation = "select";
    let payload: unknown = null;

    const builder = {
      select(_columns?: unknown) {
        recordCalls([{ method: "select", args: [_columns] }]);
        return builder;
      },
      insert(input: unknown) {
        recordCalls([{ method: "insert", args: [input] }]);
        operation = "insert";
        payload = input;
        return builder;
      },
      update(input: unknown) {
        recordCalls([{ method: "update", args: [input] }]);
        operation = "update";
        payload = input;
        return builder;
      },
      delete() {
        recordCalls([{ method: "delete", args: [] }]);
        operation = "delete";
        return builder;
      },
      eq(column: string, value: unknown) {
        recordCalls([{ method: "eq", args: [column, value] }]);
        working = working.filter((row) => row[column] === value);
        return builder;
      },
      in(column: string, values: unknown[]) {
        recordCalls([{ method: "in", args: [column, values] }]);
        working = working.filter((row) => values.includes(row[column] as never));
        return builder;
      },
      gte(column: string, value: unknown) {
        recordCalls([{ method: "gte", args: [column, value] }]);
        working = working.filter((row) => String(row[column]) >= String(value));
        return builder;
      },
      lt(column: string, value: unknown) {
        recordCalls([{ method: "lt", args: [column, value] }]);
        working = working.filter((row) => String(row[column]) < String(value));
        return builder;
      },
      order(column?: string) {
        recordCalls([{ method: "order", args: [column] }]);
        return builder;
      },
      range(from?: number, to?: number) {
        recordCalls([{ method: "range", args: [from, to] }]);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: working[0] ?? null, error: null });
      },
      single() {
        return Promise.resolve({ data: working[0] ?? null, error: null });
      },
      then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
        const attempt = shared.calls.filter((call) => call.method === operation).length;
        const failure = tables[table]?.fail?.(calls, operation, attempt);
        if (failure) return resolve({ data: null, error: failure });
        if (operation === "select") {
          return resolve({ data: working.map((row) => ({ ...row })), error: null });
        }
        if (operation === "insert") {
          const inputRows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
          const inserted = inputRows.map((row) => ({ ...row, id: `db-row-${nextRowId++}` }));
          shared.rows.push(...inserted);
          return resolve({ data: inserted, error: null });
        }
        if (operation === "update") {
          const targetIds = new Set(working.map((row) => row.id));
          for (const row of shared.rows) {
            if (targetIds.has(row.id)) Object.assign(row, payload as object);
          }
          return resolve({ data: null, error: null });
        }
        const removedIds = new Set(working.map((row) => row.id));
        shared.rows = shared.rows.filter((row) => !removedIds.has(row.id));
        state.set(table, shared);
        return resolve({ data: null, error: null });
      },
    };
    return builder;
  }

  return {
    from: (table: string) => buildQuery(table),
    callsOn: (table: string) => tableState(table).calls,
    rowsOf: (table: string) => tableState(table).rows,
  };
}

const item: PlaidItemRow = {
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

const MERCHANT = "E2E LOCAL DETECT 130";
const EXPECTED_IDENTITY = recurringIdentityKey({
  userId: "user-1",
  accountId: "account-1",
  streamType: "outflow",
  merchantIdentity: normalizeRecurringMerchant(MERCHANT),
  frequency: "MONTHLY",
});

function canonicalRow(overrides: Partial<CanonicalFinanceTransaction>): CanonicalFinanceTransaction {
  return {
    id: "src-1",
    sourceTransactionId: "src-1",
    date: "2026-07-15",
    signedAmount: 24,
    flow: "expense",
    merchant: MERCHANT,
    groupKey: "OTHER",
    categoryKey: "OTHER",
    accountId: "account-1",
    manualAccountId: null,
    pending: false,
    source: "plaid",
    ...overrides,
  };
}

function rawTransaction(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    user_id: "user-1",
    account_id: "account-1",
    date: "2026-07-15",
    authorized_date: null,
    amount: 24,
    merchant_name: MERCHANT,
    name: MERCHANT,
    pfc_primary: null,
    pfc_detailed: null,
    payment_channel: "online",
    iso_currency_code: "USD",
    pending: false,
    ...overrides,
  };
}

const SERIES_DATES = ["2026-06-15", "2026-07-15", "2026-08-15"];
const SERIES_IDS = ["txn-1", "txn-2", "txn-3"];

/** Three qualifying monthly occurrences; txn-2 is an imported row. */
function seedMonthlySeries() {
  return SERIES_IDS.map((id, index) =>
    rawTransaction(id, { date: SERIES_DATES[index] }),
  );
}

function canonicalMonthlySeries(): CanonicalFinanceTransaction[] {
  return SERIES_IDS.map((id, index) =>
    canonicalRow({ id, sourceTransactionId: id, date: SERIES_DATES[index], source: index === 1 ? "import" : "plaid" }),
  );
}

function baseTables(): Record<string, TableSpec> {
  return {
    accounts: {
      rows: [
        { id: "account-1", user_id: "user-1", plaid_item_id: "item-db-1" },
        { id: "account-2", user_id: "user-1", plaid_item_id: "item-db-2" },
      ],
    },
    transactions: { rows: seedMonthlySeries() },
    recurring_streams: { rows: [] },
    recurring_stream_transactions: { rows: [] },
  };
}

function projectionRows(rows: CanonicalFinanceTransaction[]) {
  mockLoadCanonicalProjection.mockResolvedValue({
    transactions: rows,
    currencyByAccountId: new Map(),
    truncated: false,
  });
}

describe("refreshInferredRecurringForItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes canonical loading to the owner in mine scope with pending excluded and paged reads", async () => {
    const client = createMockClient(baseTables());
    clientRef.current = client;
    projectionRows(canonicalMonthlySeries());

    await refreshInferredRecurringForItem(item, { today: TODAY });

    expect(mockLoadCanonicalProjection).toHaveBeenCalledTimes(1);
    const options = mockLoadCanonicalProjection.mock.calls[0]![1] as {
      scope: { kind: string; ownerUserId: string };
      excludePending?: boolean;
    };
    expect(options.scope).toEqual({ kind: "mine", ownerUserId: "user-1" });
    expect(options.excludePending).toBe(true);

    const transactionCalls = client.callsOn("transactions");
    expect(
      transactionCalls.some(({ method, args }) => method === "eq" && args[0] === "user_id" && args[1] === "user-1"),
    ).toBe(true);
    expect(
      transactionCalls.some(({ method, args }) => method === "eq" && args[0] === "pending" && args[1] === false),
    ).toBe(true);
    expect(
      transactionCalls.some(
        ({ method, args }) => method === "in" && args[0] === "account_id" && (args[1] as string[]).includes("account-1"),
      ),
    ).toBe(true);
    expect(transactionCalls.some(({ method, args }) => method === "gte" && args[0] === "date")).toBe(true);
    expect(transactionCalls.some(({ method, args }) => method === "lt" && args[0] === "date")).toBe(true);
    expect(transactionCalls.some(({ method, args }) => method === "order" && args[0] === "date")).toBe(true);
    expect(transactionCalls.some(({ method, args }) => method === "order" && args[0] === "id")).toBe(true);
    expect(
      transactionCalls.some(({ method, args }) => method === "range" && args[0] === 0 && args[1] === 999),
    ).toBe(true);
  });

  it("materializes one stable inferred row, keeping imported rows eligible and everything else out", async () => {
    const client = createMockClient(baseTables());
    clientRef.current = client;
    projectionRows([
      ...canonicalMonthlySeries(),
      // Refund-netted charge: canonical flow transfer, never a candidate.
      canonicalRow({ id: "txn-refund-pair", sourceTransactionId: "txn-refund-pair", flow: "transfer" }),
      // Manual-account-only row: not connected to this item.
      canonicalRow({ id: "txn-manual", sourceTransactionId: "txn-manual", accountId: null, manualAccountId: "manual-1" }),
      // Another item's account.
      canonicalRow({ id: "txn-other-item", sourceTransactionId: "txn-other-item", accountId: "account-9" }),
    ]);

    const result = await refreshInferredRecurringForItem(item, { today: TODAY });

    expect(result).toEqual({ active: 1, added: 1, deactivated: 0, deduplicated: 0 });
    const inserts = client
      .callsOn("recurring_streams")
      .filter(({ method }) => method === "insert")
      .map(({ args }) => args[0]) as Array<Record<string, unknown>>;
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      source: "inferred",
      status: "MATURE",
      detection_version: 1,
      frequency: "MONTHLY",
      merchant_name: MERCHANT,
      stream_id: `inferred:${EXPECTED_IDENTITY}`,
      identity_key: EXPECTED_IDENTITY,
    });
    expect(inserts[0]!.detection_evidence).toMatchObject({ occurrenceCount: 3 });
    expect(inserts[0]).not.toHaveProperty("reviewed_at");
    expect(inserts[0]).not.toHaveProperty("dismissed_at");
    expect(inserts[0]).not.toHaveProperty("user_amount");

    const joinInserts = client
      .callsOn("recurring_stream_transactions")
      .filter(({ method }) => method === "insert")
      .flatMap(({ args }) => args[0] as Array<Record<string, unknown>>);
    expect(joinInserts.map((row) => row.transaction_id)).toEqual(["txn-1", "txn-2", "txn-3"]);
  });

  it("is idempotent: a rerun updates the stable row instead of adding one", async () => {
    const client = createMockClient({
      ...baseTables(),
      recurring_streams: {
        rows: [
          {
            id: "db-existing",
            user_id: "user-1",
            plaid_item_id: "item-db-1",
            identity_key: EXPECTED_IDENTITY,
            source: "inferred",
            is_active: true,
          },
        ],
      },
    });
    clientRef.current = client;
    projectionRows(canonicalMonthlySeries());

    const result = await refreshInferredRecurringForItem(item, { today: TODAY });

    expect(result).toEqual({ active: 1, added: 0, deactivated: 0, deduplicated: 0 });
    const updates = client
      .callsOn("recurring_streams")
      .filter(({ method }) => method === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.args[0]).toMatchObject({ identity_key: EXPECTED_IDENTITY, is_active: true });
    expect(client.callsOn("recurring_streams").some(({ method }) => method === "insert")).toBe(false);
  });

  it("defers to an overlapping Plaid stream and counts the candidate deduplicated", async () => {
    const client = createMockClient({
      ...baseTables(),
      recurring_streams: {
        rows: [
          {
            id: "db-plaid",
            user_id: "user-1",
            plaid_item_id: "item-db-1",
            stream_type: "outflow",
            account_id: "account-1",
            frequency: "MONTHLY",
            merchant_name: MERCHANT,
            description: MERCHANT,
            identity_key: null,
            is_active: true,
            reviewed_at: null,
            dismissed_at: null,
            user_amount: null,
            source: "plaid",
          },
        ],
      },
      recurring_stream_transactions: {
        rows: [{ recurring_stream_id: "db-plaid", user_id: "user-1", transaction_id: "txn-2" }],
      },
    });
    clientRef.current = client;
    projectionRows(canonicalMonthlySeries());

    const result = await refreshInferredRecurringForItem(item, { today: TODAY });

    expect(result).toEqual({ active: 0, added: 0, deactivated: 0, deduplicated: 1 });
    expect(client.callsOn("recurring_streams").some(({ method }) => method === "insert")).toBe(false);
  });

  it("transfers review and amount state into null Plaid fields before deactivating the inferred row", async () => {
    const client = createMockClient({
      ...baseTables(),
      recurring_streams: {
        rows: [
          {
            id: "db-plaid",
            user_id: "user-1",
            plaid_item_id: "item-db-1",
            stream_type: "outflow",
            account_id: "account-1",
            frequency: "MONTHLY",
            merchant_name: MERCHANT,
            description: MERCHANT,
            identity_key: EXPECTED_IDENTITY,
            is_active: true,
            reviewed_at: null,
            dismissed_at: null,
            user_amount: null,
            source: "plaid",
          },
          {
            id: "db-inferred",
            user_id: "user-1",
            plaid_item_id: "item-db-1",
            identity_key: EXPECTED_IDENTITY,
            source: "inferred",
            is_active: true,
            reviewed_at: "2026-08-01T00:00:00Z",
            dismissed_at: null,
            user_amount: "19.99",
          },
        ],
      },
    });
    clientRef.current = client;
    projectionRows(canonicalMonthlySeries());

    const result = await refreshInferredRecurringForItem(item, { today: TODAY });

    expect(result.deduplicated).toBe(1);
    const updates = client
      .callsOn("recurring_streams")
      .filter(({ method }) => method === "update");
    const transfer = updates.find(({ args }) => "reviewed_at" in (args[0] as Record<string, unknown>));
    expect(transfer).toBeDefined();
    expect(transfer!.args[0]).toEqual({
      reviewed_at: "2026-08-01T00:00:00Z",
      user_amount: 19.99,
    });
    const deactivate = updates.find(
      ({ args }) => (args[0] as Record<string, unknown>).is_active === false,
    );
    expect(deactivate).toBeDefined();
  });

  it("sweeps inferred rows the pass no longer materializes, scoped to the item and source", async () => {
    const client = createMockClient({
      ...baseTables(),
      recurring_streams: {
        rows: [
          {
            id: "db-stale",
            user_id: "user-1",
            plaid_item_id: "item-db-1",
            identity_key: "stale-identity",
            source: "inferred",
            is_active: true,
          },
        ],
      },
    });
    clientRef.current = client;
    projectionRows(canonicalMonthlySeries());

    const result = await refreshInferredRecurringForItem(item, { today: TODAY });

    expect(result).toEqual({ active: 1, added: 1, deactivated: 1, deduplicated: 0 });
    const allCalls = client.callsOn("recurring_streams");
    const sweepIndex = allCalls.findIndex(
      ({ method, args }) => method === "update" && (args[0] as Record<string, unknown>).is_active === false,
    );
    expect(sweepIndex).toBeGreaterThanOrEqual(0);
    const sweepFilters = allCalls
      .slice(sweepIndex + 1)
      .filter(({ method }) => method === "eq" || method === "in");
    const sweepFilterArgs = sweepFilters.flatMap(({ args }) => args);
    expect(sweepFilterArgs).toContain("inferred");
    expect(sweepFilterArgs).toContain("item-db-1");
    const sweptIds = sweepFilterArgs.find((args) => Array.isArray(args)) as string[];
    expect(sweptIds).toContain("db-stale");
  });

  it("leaves stored rows unchanged when a read fails before any mutation", async () => {
    const client = createMockClient({
      ...baseTables(),
      recurring_streams: {
        rows: [],
        fail: (_calls, operation, attempt) =>
          operation === "select" && attempt >= 2 ? { code: "PGRST301" } : null,
      },
    });
    clientRef.current = client;
    projectionRows(canonicalMonthlySeries());

    await expect(refreshInferredRecurringForItem(item, { today: TODAY })).rejects.toMatchObject({
      code: "PGRST301",
    });
    expect(client.callsOn("recurring_streams").some(({ method }) => method === "insert")).toBe(false);
    expect(client.callsOn("recurring_streams").some(({ method }) => method === "update")).toBe(false);
  });

  it("recovers from a concurrent identity race by reloading the winner and updating it", async () => {
    const winner = {
      id: "db-winner",
      user_id: "user-1",
      plaid_item_id: "item-db-1",
      identity_key: EXPECTED_IDENTITY,
      source: "inferred",
      is_active: true,
    };
    let insertAttempts = 0;
    const client = createMockClient({
      ...baseTables(),
      recurring_streams: {
        rows: [],
        fail: (_calls, operation) => {
          if (operation === "insert") {
            insertAttempts += 1;
            if (insertAttempts === 1) {
              // The concurrent writer lands between our insert attempt and
              // the reload below.
              client.rowsOf("recurring_streams").push(winner);
              return { code: "23505" };
            }
          }
          return null;
        },
      },
    });
    clientRef.current = client;
    projectionRows(canonicalMonthlySeries());

    const result = await refreshInferredRecurringForItem(item, { today: TODAY });

    expect(result).toEqual({ active: 1, added: 1, deactivated: 0, deduplicated: 0 });
    const joinInserts = client
      .callsOn("recurring_stream_transactions")
      .filter(({ method }) => method === "insert")
      .flatMap(({ args }) => args[0] as Array<Record<string, unknown>>);
    expect(joinInserts).toHaveLength(3);
    expect(joinInserts.every((row) => row.recurring_stream_id === "db-winner")).toBe(true);
  });
});

describe("refreshInferredRecurringForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates item results across every active item", async () => {
    mockListActiveItems.mockResolvedValue([
      { ...item, id: "item-db-1" },
      { ...item, id: "item-db-2" },
    ]);
    const client = createMockClient(baseTables());
    clientRef.current = client;
    projectionRows([
      ...canonicalMonthlySeries(),
      ...canonicalMonthlySeries().map((row) => ({
        ...row,
        accountId: "account-2",
        id: `${row.sourceTransactionId}-b`,
        sourceTransactionId: `${row.sourceTransactionId}-b`,
      })),
    ]);
    // Raw metadata rows for the second item's account.
    client.rowsOf("transactions").push(
      ...SERIES_IDS.map((id, index) =>
        rawTransaction(`${id}-b`, { date: SERIES_DATES[index], account_id: "account-2" }),
      ),
    );

    const result = await refreshInferredRecurringForUser("user-1", { today: TODAY });

    expect(result).toEqual({ active: 2, added: 2, deactivated: 0, deduplicated: 0 });
  });
});
