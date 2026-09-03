import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) => {
    return new Response(JSON.stringify({ error: message }), { status: 400 });
  },
  errorResponse: (_context: unknown, error: unknown) => {
    throw error;
  },
}));

const mockIsExportAllowed = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/export", () => ({
  isExportAllowed: (...args: unknown[]) => mockIsExportAllowed(...args),
}));

const mockLoadCanonicalProjection = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/finance-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance-query")>()),
  loadCanonicalProjection: (...args: unknown[]) => mockLoadCanonicalProjection(...args),
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

type QueryCall = { method: string; args: unknown[] };

/**
 * Chainable thenable stub for the annotation tag read: every builder method
 * records its call and returns the builder, which resolves to the seeded rows.
 */
function queryStub(data: unknown[]) {
  const calls: QueryCall[] = [];
  const builder: { calls: QueryCall[] } & Record<string, unknown> = {
    calls,
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data, error: null }),
  };
  for (const method of ["select", "eq", "in", "order", "range", "insert"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  return builder;
}

const tables: Record<string, ReturnType<typeof queryStub>> = {};
const seeds: Record<string, unknown[]> = {};
const mockSupabase = {
  from: vi.fn((table: string) => {
    tables[table] ??= queryStub(seeds[table] ?? []);
    return tables[table];
  }),
};
const mockServiceClient = {
  from: vi.fn(() => queryStub([])),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

import { GET as taxGet } from "@/app/api/export/tax/route";
import { NextRequest, NextResponse } from "next/server";

const USER_ID = "11111111-1111-1111-1111-111111111111";

/** Chainable thenable resolving `{ data: null, error }` — the query-error shape. */
function thenableErr(error: unknown) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error }),
  };
  for (const method of ["select", "eq", "in", "order", "range"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function callYear(args: unknown[], column: string, value: unknown) {
  return args[0] === column && args[1] === value;
}

describe("GET /api/export/tax", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tables)) delete tables[key];
    seeds.transaction_annotations = [];
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: mockSupabase });
    mockIsExportAllowed.mockResolvedValue(true);
    mockLoadCanonicalProjection.mockResolvedValue({
      transactions: [],
      currencyByAccountId: new Map(),
      truncated: false,
    });
  });

  it("403s when the export gate is off", async () => {
    mockIsExportAllowed.mockResolvedValue(false);
    const res = await taxGet(new NextRequest("http://localhost/api/export/tax"));
    expect(res.status).toBe(403);
  });

  it("400s on a malformed year", async () => {
    const res = await taxGet(new NextRequest("http://localhost/api/export/tax?year=20x6"));
    expect(res.status).toBe(400);
  });

  it("reads the requested year's window through the personal scope", async () => {
    await taxGet(new NextRequest("http://localhost/api/export/tax?year=2025"));
    expect(mockLoadCanonicalProjection).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({
        scope: { kind: "mine", ownerUserId: USER_ID },
        window: { start: "2025-01-01", endExclusive: "2026-01-01" },
      }),
    );
  });

  it("scopes the annotation tag read to the user", async () => {
    mockLoadCanonicalProjection.mockResolvedValue({
      transactions: [
        {
          sourceTransactionId: "t1",
          date: "2025-06-01",
          merchant: "Food Bank",
          signedAmount: 75,
        },
      ],
      currencyByAccountId: new Map(),
      truncated: false,
    });
    await taxGet(new NextRequest("http://localhost/api/export/tax?year=2025"));
    const calls = tables.transaction_annotations.calls;
    expect(calls.some(({ method, args }) => method === "in" && args[0] === "transaction_id")).toBe(true);
    expect(calls.some(({ args }) => callYear(args, "user_id", USER_ID))).toBe(true);
  });

  it("emits detail rows grouped by tax line item plus a summary block", async () => {
    mockLoadCanonicalProjection.mockResolvedValue({
      transactions: [
        {
          sourceTransactionId: "t1",
          date: "2025-06-01",
          merchant: "Food Bank",
          signedAmount: 75,
        },
        {
          sourceTransactionId: "t2",
          date: "2025-06-02",
          merchant: "",
          signedAmount: -50,
        },
        // Not tax-tagged: must not appear anywhere in the file.
        {
          sourceTransactionId: "t3",
          date: "2025-06-03",
          merchant: "Airline",
          signedAmount: 400,
        },
      ],
      currencyByAccountId: new Map(),
      truncated: false,
    });
    seeds.transaction_annotations = [
      { transaction_id: "t1", tags: ["charity"] },
      { transaction_id: "t2", tags: ["tax"] },
    ];
    const res = await taxGet(new NextRequest("http://localhost/api/export/tax?year=2025"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("fundflow-tax-2025.csv");
    const csv = await res.text();
    expect(csv).toContain("Date,Description,Category,Amount,Type");
    expect(csv).toContain("Charitable donations");
    expect(csv).toContain("Other tax-tagged");
    expect(csv).toContain("Tax line item,Transactions,Total");
    expect(csv).not.toContain("Airline");
  });

  it("flags truncation honestly", async () => {
    mockLoadCanonicalProjection.mockResolvedValue({
      transactions: [],
      currencyByAccountId: new Map(),
      truncated: true,
    });
    const res = await taxGet(new NextRequest("http://localhost/api/export/tax"));
    expect(res.headers.get("X-FundFlow-Truncated")).toBe("true");
  });
});

describe("GET /api/export/tax — remaining branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seeds.transaction_annotations = [];
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: mockSupabase });
    mockIsExportAllowed.mockResolvedValue(true);
    mockLoadCanonicalProjection.mockResolvedValue({
      transactions: [],
      currencyByAccountId: new Map(),
      truncated: false,
    });
  });

  it("defaults to the current year when no year param is given", async () => {
    const res = await taxGet(new NextRequest("http://localhost/api/export/tax"));
    expect(res.status).toBe(200);
    const year = new Date().getUTCFullYear();
    expect(mockLoadCanonicalProjection).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({
        window: { start: `${year}-01-01`, endExclusive: `${year + 1}-01-01` },
      }),
    );
  });

  it("surfaces an annotation read failure through the error path", async () => {
    mockLoadCanonicalProjection.mockResolvedValue({
      transactions: [{ sourceTransactionId: "t1", date: "2025-06-01", merchant: "X", signedAmount: 1 }],
      currencyByAccountId: new Map(),
      truncated: false,
    });
    // The mocked errorResponse rethrows, so the route's catch surfaces as a
    // rejection here while still exercising the error branch.
    mockSupabase.from.mockImplementationOnce(
      (() => thenableErr({ message: "annotation query failed", code: "P0001" })) as never,
    );
    await expect(
      taxGet(new NextRequest("http://localhost/api/export/tax?year=2025")),
    ).rejects.toThrow("annotation query failed");
  });

  it("tolerates null annotation pages and null tags", async () => {
    mockLoadCanonicalProjection.mockResolvedValue({
      transactions: [{ sourceTransactionId: "t1", date: "2025-06-01", merchant: "X", signedAmount: 1 }],
      currencyByAccountId: new Map(),
      truncated: false,
    });
    mockSupabase.from.mockImplementationOnce((() => thenableErr(null)) as never);
    seeds.transaction_annotations = [{ transaction_id: "t1", tags: null }];
    const res = await taxGet(new NextRequest("http://localhost/api/export/tax?year=2025"));
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("Date,Description,Category,Amount,Type");
  });

  it("returns the auth response when signed out", async () => {
    mockRequireUser.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await taxGet(new NextRequest("http://localhost/api/export/tax"));
    expect(res.status).toBe(401);
  });

  it("ignores annotation rows whose tags are not a string list", async () => {
    mockLoadCanonicalProjection.mockResolvedValue({
      transactions: [
        { sourceTransactionId: "t1", date: "2025-06-01", merchant: "Food Bank", signedAmount: 75 },
      ],
      currencyByAccountId: new Map(),
      truncated: false,
    });
    seeds.transaction_annotations = [
      { transaction_id: "t1", tags: "charity" }, // not an array: ignored
      { transaction_id: "t9", tags: [1, 2] }, // non-string entries: ignored
    ];
    const res = await taxGet(new NextRequest("http://localhost/api/export/tax?year=2025"));
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).not.toContain("Charitable donations");
  });

  it("emits headers only when nothing is tax-tagged", async () => {
    const res = await taxGet(new NextRequest("http://localhost/api/export/tax?year=2025"));
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("Date,Description,Category,Amount,Type");
    expect(csv).not.toContain("Tax line item,Transactions,Total");
    expect(res.headers.get("X-FundFlow-Truncated")).toBe("false");
  });
});
