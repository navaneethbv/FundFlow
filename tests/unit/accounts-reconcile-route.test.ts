import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "@/app/api/accounts/reconcile/route";
import { requireUser } from "@/lib/http";
import { writeAudit } from "@/lib/audit";

const from = vi.fn();

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), getClientIp: vi.fn(() => "127.0.0.1") }));

const ACC_ID = "11111111-1111-1111-1111-111111111111";
const T1 = "22222222-2222-2222-2222-222222222221";
const T2 = "22222222-2222-2222-2222-222222222222";

function thenable(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => resolve({ data, error }),
  };
  for (const method of [
    "select", "eq", "gte", "lte", "order", "limit", "in", "not", "maybeSingle",
    "single", "insert", "update", "upsert",
  ]) {
    builder[method] = () => builder;
  }
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: "user-123" },
    supabase: { from } as never,
  } as never);
  vi.mocked(writeAudit).mockResolvedValue(undefined);
});

function setupAccount(table = "accounts", balance = 1850) {
  from.mockImplementation((name: string) => {
    if (name === table) {
      // Account lookups use .maybeSingle(), so return a single row object.
      return thenable(
        table === "accounts"
          ? { id: ACC_ID, name: "Checking", current_balance: balance, type: "depository", subtype: "checking" }
          : { id: ACC_ID, name: "Cash", balance },
      );
    }
    if (name === "account_reconciliations") return thenable(null);
    if (name === "transactions") return thenable([
      { id: T1, date: "2026-08-01", amount: 50, merchant_name: "Gas", name: "Gas" },
      { id: T2, date: "2026-08-05", amount: 20, merchant_name: "Coffee", name: "Coffee" },
    ]);
    if (name === "transaction_annotations") return thenable([]);
    throw new Error(`unexpected ${name}`);
  });
}

describe("GET /api/accounts/reconcile", () => {
  it("returns the working set with totals for an owned plaid account", async () => {
    setupAccount();
    const res = await GET(
      new NextRequest(`http://localhost/api/accounts/reconcile?account=plaid:${ACC_ID}&statement_date=2026-08-31`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bookBalance: number;
      direction: number;
      totals: { clearedTotal: number; outstandingTotal: number; difference: number };
      transactions: unknown[];
    };
    expect(body.bookBalance).toBe(1850);
    expect(body.direction).toBe(-1);
    expect(body.totals.outstandingTotal).toBe(-70); // charges lower an asset balance
    expect(body.totals.clearedTotal).toBe(0);
    expect(body.transactions).toHaveLength(2);
  });

  it("400s on a bad account reference", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/accounts/reconcile?account=cash:x"),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/accounts/reconcile", () => {
  it("persists cleared flags via upsert and audits", async () => {
    setupAccount("accounts", 1930);
    const upsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    from.mockImplementation((name: string) => {
      if (name === "accounts") {
        return thenable({ id: ACC_ID, name: "Checking", current_balance: 1930, type: "depository", subtype: "checking" });
      }
      if (name === "transactions") return thenable([{ id: T1 }, { id: T2 }]);
      if (name === "transaction_annotations") return { upsert };
      if (name === "account_reconciliations") {
        return {
          insert: () => thenable([{ id: "stmt-1" }]),
        };
      }
      throw new Error(`unexpected ${name}`);
    });
    const res = await POST(
      new NextRequest("http://localhost/api/accounts/reconcile", {
        method: "POST",
        body: JSON.stringify({
          account: `plaid:${ACC_ID}`,
          statement_date: "2026-08-31",
          statement_balance: 1930,
          cleared_ids: [T1, T2],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account_reconciled" }),
    );
    const body = (await res.json()) as { difference: number; adjustment_amount: number };
    expect(body.difference).toBe(0);
    expect(body.adjustment_amount).toBe(0);
  });

  it("rejects cleared ids outside the account", async () => {
    setupAccount("accounts", 1930);
    from.mockImplementation((name: string) => {
      if (name === "accounts") {
        return thenable({ id: ACC_ID, name: "Checking", current_balance: 1930, type: "depository", subtype: "checking" });
      }
      if (name === "transactions") return thenable([{ id: T1 }]);
      if (name === "transaction_annotations") return thenable([]);
      if (name === "account_reconciliations") return thenable(null);
      throw new Error(`unexpected ${name}`);
    });
    const res = await POST(
      new NextRequest("http://localhost/api/accounts/reconcile", {
        method: "POST",
        body: JSON.stringify({
          account: `plaid:${ACC_ID}`,
          statement_date: "2026-08-31",
          statement_balance: 1930,
          cleared_ids: [T1, T2],
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400s on a malformed statement date", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/accounts/reconcile", {
        method: "POST",
        body: JSON.stringify({
          account: `plaid:${ACC_ID}`,
          statement_date: "August 31",
          statement_balance: 100,
          cleared_ids: [],
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns the auth response when signed out", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await POST(
      new NextRequest("http://localhost/api/accounts/reconcile", {
        method: "POST",
        body: JSON.stringify({ account: `plaid:${ACC_ID}`, statement_date: "2026-08-31", statement_balance: 1 }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
