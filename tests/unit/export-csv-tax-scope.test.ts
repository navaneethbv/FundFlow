import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (_context: unknown, error: unknown) => {
    throw error;
  },
}));

const mockVerifyApiToken = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/api-tokens", () => ({
  verifyApiToken: (...args: unknown[]) => mockVerifyApiToken(...args),
}));

const mockFetchPrivacySafeRows = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/export", () => ({
  fetchPrivacySafeRows: (...args: unknown[]) => mockFetchPrivacySafeRows(...args),
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

/**
 * Chainable query recorder: every builder method returns `this`, and the
 * object is thenable, so it stands in for any select/eq/contains/in/order
 * ordering the route happens to use.
 */
type QueryCall = { method: string; args: unknown[] };
type QueryStub = { calls: QueryCall[] } & Record<string, unknown>;

function queryStub(data: unknown[]): QueryStub {
  const calls: QueryCall[] = [];
  const builder: QueryStub = {
    calls,
    then: (resolve: (value: { data: unknown[] }) => unknown) => resolve({ data }),
  };
  for (const method of ["select", "eq", "contains", "in", "order", "insert"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  return builder;
}

const tables: Record<string, ReturnType<typeof queryStub>> = {};
const seeds: Record<string, unknown[]> = {};
const mockServiceClient = {
  from: vi.fn((table: string) => {
    tables[table] ??= queryStub(seeds[table] ?? []);
    return tables[table];
  }),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

import { GET as csvGet } from "@/app/api/export/csv/route";
import { NextResponse, NextRequest } from "next/server";

/** Did this table's query chain scope by the given user id? */
function scopedToUser(table: string, userId: string) {
  return (tables[table]?.calls ?? []).some(
    ({ method, args }) => method === "eq" && args[0] === "user_id" && args[1] === userId,
  );
}

describe("GET /api/export/csv?scope=tax — API-token path", () => {
  const TOKEN_USER = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tables)) delete tables[key];
    // A tagged row must come back, or the route short-circuits before it ever
    // queries transactions and the second test would pass vacuously.
    seeds.transaction_annotations = [
      { transaction_id: "22222222-2222-2222-2222-222222222222" },
    ];
    // No session: requireUser 401s, so the route falls through to the token
    // path, where supabase is the RLS-bypassing service client.
    mockRequireUser.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    mockVerifyApiToken.mockResolvedValue(TOKEN_USER);
    mockFetchPrivacySafeRows.mockResolvedValue({ allowed: true, rows: [] });
  });

  const request = new NextRequest("http://localhost/api/export/csv?scope=tax");

  it("scopes the tax-tag lookup to the token's user", async () => {
    await csvGet(request);
    expect(scopedToUser("transaction_annotations", TOKEN_USER)).toBe(true);
  });

  it("scopes the tax transaction fetch to the token's user", async () => {
    await csvGet(request);
    expect(scopedToUser("transactions", TOKEN_USER)).toBe(true);
  });
});
