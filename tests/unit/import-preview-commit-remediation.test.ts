import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn(
  (_context: unknown, error: unknown) =>
    NextResponse.json({ error: String(error) }, { status: 500 }),
);
const mockBadRequest = vi.fn((message: unknown) =>
  NextResponse.json({ error: String(message) }, { status: 400 }),
);

vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockParseImportCsv = vi.fn<(...args: unknown[]) => unknown>();
const mockBuildImportReview = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("@/lib/import", () => ({
  detectSourceFormat: () => "csv",
  getCsvColumns: () => null,
  normalizeColumnMap: () => null,
  parseImportCsv: (...args: unknown[]) => mockParseImportCsv(...args),
  makeImportId: (accountId: string, row: { date: string; merchant: string }, occurrence: number) =>
    `import-${accountId}-${row.date}-${row.merchant}-${occurrence}`,
}));

vi.mock("@/lib/planning", () => ({
  buildImportReview: (...args: unknown[]) => mockBuildImportReview(...args),
}));

vi.mock("@/lib/import-ofx", () => ({ parseOfx: () => [] }));
vi.mock("@/lib/import-mint", () => ({ parseMintCsv: () => ({ rows: [], errors: [] }) }));
vi.mock("@/lib/import-monarch", () => ({ parseMonarchCsv: () => ({ rows: [], errors: [] }) }));
vi.mock("@/lib/import-ynab", () => ({ parseYnabCsv: () => ({ rows: [], errors: [] }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => Promise.resolve(true) }));

const mockServiceClient = { from: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

import { POST as previewPost } from "@/app/api/import/preview/route";
import { POST as commitPost } from "@/app/api/import/commit/route";

type QueryState = {
  eq: Array<[string, unknown]>;
  in: Array<[string, unknown[]]>;
  order: Array<[string, unknown]>;
  range: [number, number] | null;
};

type QueryResult = { data: unknown; error: unknown };

function queryBuilder(
  resolve: (state: QueryState, terminal: "await" | "single" | "maybeSingle" | "range") => QueryResult,
) {
  const state: QueryState = { eq: [], in: [], order: [], range: null };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      state.eq.push([column, value]);
      return builder;
    }),
    in: vi.fn((column: string, values: unknown[]) => {
      state.in.push([column, values]);
      return builder;
    }),
    order: vi.fn((column: string, options?: unknown) => {
      state.order.push([column, options]);
      return builder;
    }),
    limit: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) => {
      state.range = [from, to];
      return Promise.resolve(resolve(state, "range"));
    }),
    single: vi.fn(() => Promise.resolve(resolve(state, "single"))),
    maybeSingle: vi.fn(() => Promise.resolve(resolve(state, "maybeSingle"))),
    then: (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(resolve(state, "await")).then(onFulfilled, onRejected),
    state,
  };
  return builder;
}

function previewRequest(fileName = "statement.csv") {
  const formData = new FormData();
  formData.set("file", new File(["data"], fileName, { type: "text/csv" }));
  return { formData: () => Promise.resolve(formData) } as unknown as NextRequest;
}

describe("import preview and commit remediation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("paginates existing transactions deterministically and chunks staged-row inserts", async () => {
    const parsedRows = Array.from({ length: 1_001 }, (_, index) => ({
      date: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
      merchant: `Merchant ${index}`,
      amount: index + 1,
    }));
    const reviewRows = parsedRows.map((row, index) => ({
      rowHash: `hash-${index}`,
      row,
      flags: [],
    }));
    mockParseImportCsv.mockReturnValue({ rows: parsedRows, errors: [] });
    mockBuildImportReview.mockReturnValue({ rows: reviewRows });

    const existingRows = Array.from({ length: 1_001 }, (_, index) => ({
      id: `existing-${index}`,
      date: "2026-06-01",
      amount: index,
      merchant_name: `Existing ${index}`,
      name: null,
      pfc_primary: "SHOPPING",
    }));
    const transactionQueries: ReturnType<typeof queryBuilder>[] = [];
    const authClient = {
      from: vi.fn((table: string) => {
        expect(table).toBe("transactions");
        const query = queryBuilder((state, terminal) => {
          const [from, to] = state.range ?? [0, 999];
          return {
            data: terminal === "range" ? existingRows.slice(from, to + 1) : existingRows.slice(0, 1_000),
            error: null,
          };
        });
        transactionQueries.push(query);
        return query;
      }),
    };
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

    const rowInsert = vi.fn((payload: Array<Record<string, unknown>>) => ({
      select: vi.fn().mockResolvedValue({
        data: payload.map((row) => ({
          id: `row-${row.row_index}`,
          date: row.date,
          description: row.description,
          amount: row.amount,
          source_account: row.source_account,
          row_index: row.row_index,
          status: row.status,
        })),
        error: null,
      }),
    }));
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "import_review_batches") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: { id: "batch-1" }, error: null }),
            })),
          })),
        };
      }
      if (table === "import_review_rows") return { insert: rowInsert };
      return null as never;
    });

    const response = await previewPost(previewRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ rows: expect.any(Array) });
    expect(transactionQueries).toHaveLength(2);
    for (const query of transactionQueries) {
      expect(query.state.eq).toContainEqual(["user_id", "user-1"]);
      expect(query.state.order.map(([column]) => column)).toEqual(["date", "id"]);
    }
    expect(transactionQueries[0]!.range).toHaveBeenCalledWith(0, 999);
    expect(transactionQueries[1]!.range).toHaveBeenCalledWith(1_000, 1_999);
    expect(rowInsert.mock.calls.map(([rows]) => rows.length)).toEqual([500, 500, 1]);
  });

  it("rejects a missing or foreign batch before creating a service client", async () => {
    const batchQuery = queryBuilder(() => ({ data: null, error: null }));
    const authClient = {
      from: vi.fn((table: string) => {
        if (table === "import_review_batches") return batchQuery;
        if (table === "accounts") {
          return queryBuilder(() => ({ data: { id: "account-1" }, error: null }));
        }
        if (table === "import_review_rows" || table === "import_source_account_mappings") {
          return queryBuilder(() => ({ data: [], error: null }));
        }
        return queryBuilder(() => ({ data: [], error: null }));
      }),
    };
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });
    mockServiceClient.from.mockImplementation(() => ({
      select: vi.fn(() => queryBuilder(() => ({
        data: { created_at: "2026-07-01T00:00:00.000Z" },
        error: null,
      }))),
      update: vi.fn(() => queryBuilder(() => ({ data: [], error: null }))),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }));

    const response = await commitPost({
      json: () => Promise.resolve({ batch_id: "foreign-batch", account_id: "account-1" }),
    } as unknown as NextRequest);

    expect(response.status).toBe(404);
    expect(batchQuery.state.eq).toEqual([
      ["id", "foreign-batch"],
      ["user_id", "user-1"],
    ]);
    expect(mockServiceClient.from).not.toHaveBeenCalled();
  });

  it("fails closed when the owned-batch lookup errors", async () => {
    const batchQuery = queryBuilder(() => ({
      data: null,
      error: { message: "batch lookup failed" },
    }));
    const authClient = {
      from: vi.fn((table: string) => {
        if (table === "import_review_batches") return batchQuery;
        if (table === "accounts") {
          return queryBuilder(() => ({ data: { id: "account-1" }, error: null }));
        }
        return queryBuilder(() => ({ data: [], error: null }));
      }),
    };
    mockRequireUser.mockResolvedValue({
      user: { id: "user-1" },
      supabase: authClient,
    });
    mockServiceClient.from.mockImplementation(() => ({
      select: vi.fn(() => queryBuilder(() => ({
        data: { created_at: "2026-07-01T00:00:00.000Z" },
        error: null,
      }))),
      update: vi.fn(() => queryBuilder(() => ({ data: [], error: null }))),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }));

    const response = await commitPost({
      json: () => Promise.resolve({ batch_id: "batch-1", account_id: "account-1" }),
    } as unknown as NextRequest);

    expect(response.status).toBe(500);
    expect(mockServiceClient.from).not.toHaveBeenCalled();
  });

  it("owner-scopes targets, paginates batch rows, and chunks all bulk commit operations", async () => {
    const rowCount = 1_001;
    const batchRows = Array.from({ length: rowCount }, (_, index) => ({
      id: `row-${index}`,
      date: "2026-07-01",
      description: `Merchant ${index}`,
      amount: index + 1,
      category: "Dining",
      source_account: `Source ${index}`,
      notes: `Note ${index}`,
      tags: [`tag-${index}`],
      row_index: index,
      status: "pending",
    }));
    const accountMappings = Object.fromEntries(
      batchRows.map((row, index) => [row.source_account, { account_id: `account-${index + 1}` }]),
    );
    const approvedRowIds = batchRows.map((row) => row.id);

    const authQueries: Array<{ table: string; query: ReturnType<typeof queryBuilder> }> = [];
    const authClient = {
      from: vi.fn((table: string) => {
        const query = queryBuilder((state, terminal) => {
          if (table === "import_review_batches") {
            return { data: { id: "batch-1", created_at: "2026-07-01T00:00:00.000Z" }, error: null };
          }
          if (table === "accounts") {
            const ids = state.in.at(-1)?.[1];
            if (ids) return { data: ids.map((id) => ({ id })), error: null };
            return { data: { id: "account-0" }, error: null };
          }
          if (table === "manual_accounts") return { data: [], error: null };
          if (table === "import_source_account_mappings") return { data: [], error: null };
          if (table === "import_review_rows") {
            const [from, to] = state.range ?? [0, 999];
            return {
              data: terminal === "range" ? batchRows.slice(from, to + 1) : batchRows.slice(0, 1_000),
              error: null,
            };
          }
          return { data: [], error: null };
        });
        authQueries.push({ table, query });
        return query;
      }),
    };
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

    const serviceQueries: Array<{
      table: string;
      operation: "select" | "update";
      query: ReturnType<typeof queryBuilder>;
    }> = [];
    const upserts: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];
    const committedByImportId = new Map<string, string>();
    let transactionsPersisted = false;

    mockServiceClient.from.mockImplementation((table: string) => ({
      select: vi.fn(() => {
        const query = queryBuilder((state) => {
          if (table === "transactions" && transactionsPersisted) {
            const ids = state.in.at(-1)?.[1] ?? [];
            return {
              data: ids.map((id) => ({
                id: committedByImportId.get(String(id)),
                plaid_transaction_id: id,
              })),
              error: null,
            };
          }
          if (table === "import_review_batches") {
            return { data: { created_at: "2026-07-01T00:00:00.000Z" }, error: null };
          }
          return { data: [], error: null };
        });
        serviceQueries.push({ table, operation: "select", query });
        return query;
      }),
      upsert: vi.fn(async (rows: Array<Record<string, unknown>>) => {
        upserts.push({ table, rows });
        if (table === "transactions") {
          transactionsPersisted = true;
          for (const row of rows) {
            committedByImportId.set(String(row.plaid_transaction_id), `txn-${row.rowId}`);
          }
        }
        return { error: null };
      }),
      update: vi.fn(() => {
        const query = queryBuilder(() => ({ data: [], error: null }));
        serviceQueries.push({ table, operation: "update", query });
        return query;
      }),
    }));

    const response = await commitPost({
      json: () => Promise.resolve({
        batch_id: "batch-1",
        account_id: "account-0",
        account_mappings: accountMappings,
        approved_row_ids: approvedRowIds,
      }),
    } as unknown as NextRequest);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, imported: rowCount });

    const defaultAccountQuery = authQueries.find(
      ({ table, query }) => table === "accounts" && query.state.in.length === 0,
    )!.query;
    expect(defaultAccountQuery.state.eq).toContainEqual(["user_id", "user-1"]);

    const mappedAccountQueries = authQueries.filter(
      ({ table, query }) => table === "accounts" && query.state.in.length > 0,
    );
    expect(mappedAccountQueries.map(({ query }) => query.state.in[0]![1].length)).toEqual([500, 500, 1]);
    for (const { query } of mappedAccountQueries) {
      expect(query.state.eq).toContainEqual(["user_id", "user-1"]);
    }

    const batchRowQueries = authQueries.filter(({ table }) => table === "import_review_rows");
    expect(batchRowQueries).toHaveLength(1);
    expect(batchRowQueries[0]!.query.state.eq).toContainEqual(["user_id", "user-1"]);
    expect(batchRowQueries[0]!.query.state.order.map(([column]) => column)).toEqual(["row_index", "id"]);
    expect(batchRowQueries[0]!.query.range).toHaveBeenCalledTimes(2);

    const persistedMappingQueries = authQueries.filter(
      ({ table }) => table === "import_source_account_mappings",
    );
    expect(persistedMappingQueries.map(({ query }) => query.state.in[0]![1].length)).toEqual([500, 500, 1]);
    for (const { query } of persistedMappingQueries) {
      expect(query.state.eq).toContainEqual(["user_id", "user-1"]);
    }

    expect(upserts.filter(({ table }) => table === "import_source_account_mappings").map(({ rows }) => rows.length)).toEqual([500, 500, 1]);
    expect(upserts.filter(({ table }) => table === "transactions").map(({ rows }) => rows.length)).toEqual([500, 500, 1]);
    expect(upserts.filter(({ table }) => table === "transaction_annotations").map(({ rows }) => rows.length)).toEqual([500, 500, 1]);

    const transactionSelects = serviceQueries.filter(
      ({ table, operation }) => table === "transactions" && operation === "select",
    );
    expect(transactionSelects.map(({ query }) => query.state.in[0]![1].length)).toEqual([500, 500, 1, 500, 500, 1]);
    for (const { query } of transactionSelects) {
      expect(query.state.eq).toContainEqual(["user_id", "user-1"]);
    }

    const rowStatusUpdates = serviceQueries.filter(
      ({ table, operation }) => table === "import_review_rows" && operation === "update",
    );
    expect(rowStatusUpdates.map(({ query }) => query.state.in[0]![1].length)).toEqual([500, 500, 1]);
    for (const { query } of rowStatusUpdates) {
      expect(query.state.eq).toContainEqual(["user_id", "user-1"]);
    }
  });
});
