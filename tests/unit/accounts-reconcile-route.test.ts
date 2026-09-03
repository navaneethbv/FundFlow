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
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => true) }));

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

interface TableSpec {
  /** Resolved value for awaited queries. */
  data?: unknown;
  error?: unknown;
  /** Capture write operations instead of returning data. */
  onWrite?: (op: string, args: unknown[]) => void;
}

/**
 * Table-driven stub: each table's handler decides its own resolved rows;
 * write methods are recorded. `maybeSingle` tables resolve a single object,
 * list tables an array.
 */
function mockTables(tables: Record<string, TableSpec>) {
  from.mockImplementation((name: string) => {
    const spec = tables[name];
    if (!spec) throw new Error(`unexpected table ${name}`);
    const recordWrite = (op: string) => (...args: unknown[]) => {
      spec.onWrite?.(op, args);
      return builder;
    };
    let lastIn: { column: string; values: unknown[] } | null = null;
    let lastGte: { column: string; value: unknown } | null = null;
    const resolveData = () => {
      let data = spec.data ?? null;
      if (Array.isArray(data) && lastGte) {
        data = data.filter((row) => {
          const val = (row as Record<string, unknown>)[lastGte!.column];
          return val === undefined || val === null || (val as string) >= (lastGte!.value as string);
        });
      }
      // Honor `.in("id", ...)` so ownership checks see only the filtered rows.
      if (Array.isArray(data) && lastIn?.column === "id") {
        return data.filter((row) =>
          lastIn!.values.includes((row as { id?: unknown }).id),
        );
      }
      return data;
    };
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: resolveData(), error: spec.error ?? null }),
    };
    for (const method of ["select", "eq", "lte", "order", "limit", "not", "maybeSingle", "single"]) {
      builder[method] = () => builder;
    }
    builder.gte = (column: string, value: unknown) => {
      lastGte = { column, value };
      return builder;
    };
    builder.in = (column: string, values: unknown[]) => {
      lastIn = { column, values };
      return builder;
    };
    builder.insert = recordWrite("insert");
    builder.update = recordWrite("update");
    builder.upsert = recordWrite("upsert");
    builder.delete = recordWrite("delete");
    return builder;
  });
}

const PLAID_ACCOUNT = {
  id: ACC_ID,
  name: "Checking",
  current_balance: 1850,
  type: "depository",
  subtype: "checking",
};
const MANUAL_ACCOUNT = { id: ACC_ID, name: "Cash", balance: 300 };
const TXNS = [
  { id: T1, date: "2026-08-01", amount: 50, merchant_name: "Gas", name: "Gas" },
  { id: T2, date: "2026-08-05", amount: 20, merchant_name: "Coffee", name: "Coffee" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: "user-123" },
    supabase: { from } as never,
  } as never);
  vi.mocked(writeAudit).mockResolvedValue(undefined);
});

describe("GET /api/accounts/reconcile", () => {
  it("returns the working set with totals for an owned plaid account", async () => {
    mockTables({
      accounts: { data: PLAID_ACCOUNT },
      account_reconciliations: { data: null },
      transactions: { data: TXNS },
      transaction_annotations: { data: [] },
    });
    const res = await GET(
      new NextRequest(`http://localhost/api/accounts/reconcile?account=plaid:${ACC_ID}&statement_date=2026-08-31`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bookBalance: number;
      direction: number;
      sinceDate: string;
      totals: { outstandingTotal: number };
    };
    expect(body.bookBalance).toBe(1850);
    expect(body.direction).toBe(-1);
    expect(body.totals.outstandingTotal).toBe(-70); // charges lower an asset balance
  });

  it("uses a manual account and honors the statement balance parameter", async () => {
    mockTables({
      manual_accounts: { data: MANUAL_ACCOUNT },
      account_reconciliations: { data: null },
      transactions: { data: TXNS },
      transaction_annotations: { data: [] },
    });
    const res = await GET(
      new NextRequest(
        `http://localhost/api/accounts/reconcile?account=manual:${ACC_ID}&statement_date=2026-08-31&statement_balance=230`,
      ),
    );
    const body = (await res.json()) as {
      account: { source: string };
      totals: { difference: number; balanced: boolean };
    };
    expect(body.account.source).toBe("manual");
    expect(body.totals.difference).toBe(70); // book 300 - statement 230
    expect(body.totals.balanced).toBe(false);
  });

  it("starts the window after the last recorded statement and flags cleared rows", async () => {
    mockTables({
      accounts: { data: PLAID_ACCOUNT },
      account_reconciliations: { data: { statement_date: "2026-07-15" } },
      transactions: { data: TXNS },
      transaction_annotations: { data: [{ transaction_id: T1, cleared_at: "2026-08-02" }] },
    });
    const res = await GET(
      new NextRequest(`http://localhost/api/accounts/reconcile?account=plaid:${ACC_ID}&statement_date=2026-08-31`),
    );
    const body = (await res.json()) as {
      sinceDate: string;
      transactions: Array<{ id: string; cleared: boolean }>;
      totals: { clearedTotal: number; clearedCount: number };
    };
    expect(body.sinceDate).toBe("2026-07-15");
    expect(body.transactions.find((t) => t.id === T1)!.cleared).toBe(true);
    expect(body.transactions.find((t) => t.id === T2)!.cleared).toBe(false);
    expect(body.totals.clearedCount).toBe(1);
  });

  it("falls back to the name descriptor when merchant_name is null", async () => {
    mockTables({
      accounts: { data: PLAID_ACCOUNT },
      account_reconciliations: { data: null },
      transactions: { data: [{ id: T1, date: "2026-08-01", amount: 5, merchant_name: null, name: "Raw descriptor" }] },
      transaction_annotations: { data: [] },
    });
    const res = await GET(
      new NextRequest(`http://localhost/api/accounts/reconcile?account=plaid:${ACC_ID}&statement_date=2026-08-31`),
    );
    const body = (await res.json()) as { transactions: Array<{ merchant: string }> };
    expect(body.transactions[0]!.merchant).toBe("Raw descriptor");
  });

  it("400s on a bad account reference or bad statement date", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/accounts/reconcile?account=cash:x"),
    );
    expect(res.status).toBe(400);
    const res2 = await GET(
      new NextRequest(`http://localhost/api/accounts/reconcile?account=plaid:${ACC_ID}&statement_date=August`),
    );
    expect(res2.status).toBe(400);
  });

  it("400s when the account is not owned", async () => {
    mockTables({ accounts: { data: null } });
    const res = await GET(
      new NextRequest(`http://localhost/api/accounts/reconcile?account=plaid:${ACC_ID}&statement_date=2026-08-31`),
    );
    expect(res.status).toBe(400);
  });

  it("surfaces a transaction read failure as a 500-style error", async () => {
    mockTables({
      accounts: { data: PLAID_ACCOUNT },
      account_reconciliations: { data: null },
      transactions: { error: { message: "boom", code: "P0001" } },
    });
    const res = await GET(
      new NextRequest(`http://localhost/api/accounts/reconcile?account=plaid:${ACC_ID}&statement_date=2026-08-31`),
    );
    expect(res.status).toBe(500);
  });
});

describe("POST /api/accounts/reconcile", () => {
  const writes: Record<string, Array<{ op: string; args: unknown[] }>> = {};

  function setup(options: {
    source?: "plaid" | "manual";
    bookBalance?: number;
    statementBalance?: number;
  }) {
    writes.annotations = [];
    writes.transactions = [];
    writes.account_reconciliations = [];
    const source = options.source ?? "plaid";
    const bookBalance = options.bookBalance ?? 1930;
    mockTables({
      accounts: source === "plaid" ? { data: { ...PLAID_ACCOUNT, current_balance: bookBalance } } : { data: null },
      manual_accounts: source === "manual" ? { data: { ...MANUAL_ACCOUNT, balance: bookBalance } } : { data: null },
      transactions: {
        data: TXNS.map((t) => ({ id: t.id })),
        onWrite: (op, args) => writes.transactions.push({ op, args }),
      },
      transaction_annotations: {
        onWrite: (op, args) => writes.annotations.push({ op, args }),
      },
      account_reconciliations: {
        data: [{ id: "stmt-1" }],
        onWrite: (op, args) => writes.account_reconciliations.push({ op, args }),
      },
    });
    return bookBalance;
  }

  function post(body: Record<string, unknown>) {
    return POST(
      new NextRequest("http://localhost/api/accounts/reconcile", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  }

  it("returns 429 when rate limit is exceeded", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Too many requests");
  });

  it("persists cleared flags, records the statement, and audits", async () => {
    setup({ bookBalance: 1930 });
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [T1, T2],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { difference: number; adjustment_amount: number };
    expect(body.difference).toBe(0);
    expect(body.adjustment_amount).toBe(0);
    expect(writes.annotations.some((w) => w.op === "upsert")).toBe(true);
    // Both in-scope rows are cleared, so nothing is unmarked.
    expect(writes.annotations.some((w) => w.op === "update")).toBe(false);
    expect(writes.account_reconciliations.some((w) => w.op === "insert")).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account_reconciled" }),
    );
  });

  it("works for a manual account", async () => {
    setup({ source: "manual", bookBalance: 500 });
    const res = await post({
      account: `manual:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 500,
      cleared_ids: [T1],
    });
    expect(res.status).toBe(200);
    const statement = writes.account_reconciliations.find((w) => w.op === "insert");
    expect((statement!.args[0] as Record<string, unknown>).manual_account_id).toBe(ACC_ID);
  });

  it("unmarks in-scope rows the user left unchecked", async () => {
    setup({ bookBalance: 1930 });
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [T1],
    });
    expect(res.status).toBe(200);
    const update = writes.annotations.find((w) => w.op === "update");
    expect(update).toBeDefined();
    expect(update!.args[0]).toEqual({ cleared_at: null });
  });

  it("does not un-clear transactions cleared in a prior reconciliation before the previous statement date", async () => {
    writes.annotations = [];
    writes.transactions = [];
    writes.account_reconciliations = [];

    const T_EARLY = "33333333-3333-3333-3333-333333333331";
    const T_LATE = "33333333-3333-3333-3333-333333333332";

    mockTables({
      accounts: { data: { ...PLAID_ACCOUNT, current_balance: 1930 } },
      account_reconciliations: {
        data: { statement_date: "2026-07-31" },
        onWrite: (op, args) => writes.account_reconciliations.push({ op, args }),
      },
      transactions: {
        data: [
          { id: T_EARLY, date: "2026-07-15" },
          { id: T_LATE, date: "2026-08-10" },
        ],
        onWrite: (op, args) => writes.transactions.push({ op, args }),
      },
      transaction_annotations: {
        onWrite: (op, args) => writes.annotations.push({ op, args }),
      },
    });

    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [T_LATE],
    });

    expect(res.status).toBe(200);
    expect(writes.annotations.some((w) => w.op === "upsert")).toBe(true);
    const unmarks = writes.annotations.filter((w) => w.op === "update");
    expect(unmarks).toEqual([]);
  });

  it("does not create an adjustment unless the user explicitly requests one", async () => {
    setup({ bookBalance: 1980 });
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { difference: number; adjustment_amount: number };
    expect(body.difference).toBe(50);
    expect(body.adjustment_amount).toBe(0);
    expect(writes.transactions.some((w) => w.op === "insert")).toBe(false);
  });

  it("inserts an adjustment entry when the user explicitly requests one", async () => {
    // Asset, book 1980 vs statement 1930: difference 50, adjustment = +50.
    setup({ bookBalance: 1980 });
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [],
      create_adjustment: true,
      adjustment_note: "Bank fee correction",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { difference: number; adjustment_amount: number };
    expect(body.difference).toBe(50);
    expect(body.adjustment_amount).toBe(50);
    const adjustment = writes.transactions.find((w) => w.op === "insert");
    expect(adjustment).toBeDefined();
    const row = adjustment!.args[0] as Record<string, unknown>;
    expect(row.amount).toBe(50);
    expect(row.pfc_primary).toBe("RECONCILE_ADJUSTMENT");
    expect(row.account_id).toBe(ACC_ID);
  });

  it("rejects cleared ids outside the account", async () => {
    setup({ bookBalance: 1930 });
    from.mockImplementation((name: string) => {
      if (name === "accounts") return thenable({ ...PLAID_ACCOUNT, current_balance: 1930 });
      if (name === "transactions") return thenable([{ id: T1 }]); // T2 not owned by this account
      if (name === "transaction_annotations") return thenable([]);
      if (name === "account_reconciliations") return thenable(null);
      throw new Error(`unexpected ${name}`);
    });
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [T1, T2],
    });
    expect(res.status).toBe(400);
  });

  it("400s on a malformed statement date or balance", async () => {
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "August 31",
      statement_balance: 100,
      cleared_ids: [],
    });
    expect(res.status).toBe(400);
    const res2 = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: "lots",
      cleared_ids: [],
    });
    expect(res2.status).toBe(400);
  });

  it("400s when the account is not owned", async () => {
    mockTables({ accounts: { data: null }, manual_accounts: { data: null } });
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 100,
      cleared_ids: [],
    });
    expect(res.status).toBe(400);
  });

  it("propagates a statement insert failure as a 500-style error", async () => {
    mockTables({
      accounts: { data: { ...PLAID_ACCOUNT, current_balance: 1930 } },
      transactions: { data: [] },
      account_reconciliations: { error: { message: "boom", code: "P0001" } },
    });
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [],
    });
    expect(res.status).toBe(500);
  });

  it("returns the auth response when signed out", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1,
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/accounts/reconcile — edge branches", () => {
  function get(query: string) {
    return GET(new NextRequest(`http://localhost/api/accounts/reconcile${query}`));
  }

  it("returns the auth response when signed out", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await get(`?account=plaid:${ACC_ID}`);
    expect(res.status).toBe(401);
  });

  it("treats a credit card as a liability (direction 1)", async () => {
    mockTables({
      accounts: { data: { ...PLAID_ACCOUNT, type: "credit", subtype: null } },
      account_reconciliations: { data: null },
      transactions: { data: [] },
      transaction_annotations: { data: [] },
    });
    const res = await get(`?account=plaid:${ACC_ID}&statement_date=2026-08-31`);
    const body = (await res.json()) as { direction: number };
    expect(body.direction).toBe(1);
  });

  it("defaults null balances and names gracefully", async () => {
    mockTables({
      accounts: { data: { id: ACC_ID, name: null, current_balance: null, type: null, subtype: null } },
      account_reconciliations: { data: null },
      transactions: { data: [] },
      transaction_annotations: { data: [] },
    });
    const res = await get(`?account=plaid:${ACC_ID}&statement_date=2026-08-31`);
    const body = (await res.json()) as { account: { name: string }; bookBalance: number };
    expect(body.account.name).toBe("Account");
    expect(body.bookBalance).toBe(0);
  });

  it("handles a manual account with null name and balance, and a missing manual row", async () => {
    mockTables({
      manual_accounts: { data: { id: ACC_ID, name: null, balance: null } },
      account_reconciliations: { data: null },
      transactions: { data: [] },
      transaction_annotations: { data: [] },
    });
    const res = await get(`?account=manual:${ACC_ID}&statement_date=2026-08-31`);
    const body = (await res.json()) as { account: { name: string }; bookBalance: number };
    expect(body.account.name).toBe("Account");
    expect(body.bookBalance).toBe(0);

    mockTables({ manual_accounts: { data: null } });
    const res2 = await get(`?account=manual:${ACC_ID}&statement_date=2026-08-31`);
    expect(res2.status).toBe(400);
  });

  it("defaults the statement date to today when absent", async () => {
    mockTables({
      accounts: { data: PLAID_ACCOUNT },
      account_reconciliations: { data: null },
      transactions: { data: [] },
      transaction_annotations: { data: [] },
    });
    const res = await get(`?account=plaid:${ACC_ID}`);
    expect(res.status).toBe(200);
  });

  it("tolerates a non-numeric statement balance parameter", async () => {
    mockTables({
      accounts: { data: PLAID_ACCOUNT },
      account_reconciliations: { data: null },
      transactions: { data: [] },
      transaction_annotations: { data: [] },
    });
    const res = await get(`?account=plaid:${ACC_ID}&statement_date=2026-08-31&statement_balance=abc`);
    expect(res.status).toBe(200);
  });

  it("handles null transaction rows and null annotation rows", async () => {
    mockTables({
      accounts: { data: PLAID_ACCOUNT },
      account_reconciliations: { data: null },
      transactions: { data: null },
      transaction_annotations: { data: null },
    });
    const res = await get(`?account=plaid:${ACC_ID}&statement_date=2026-08-31`);
    const body = (await res.json()) as { transactions: unknown[] };
    expect(body.transactions).toEqual([]);
  });

  it("falls back to Unknown when both merchant and descriptor are null", async () => {
    mockTables({
      accounts: { data: PLAID_ACCOUNT },
      account_reconciliations: { data: null },
      transactions: { data: [{ id: T1, date: "2026-08-01", amount: 5, merchant_name: null, name: null }] },
      transaction_annotations: { data: [] },
    });
    const res = await get(`?account=plaid:${ACC_ID}&statement_date=2026-08-31`);
    const body = (await res.json()) as { transactions: Array<{ merchant: string }> };
    expect(body.transactions[0]!.merchant).toBe("Unknown");
  });
});

describe("POST /api/accounts/reconcile — edge branches", () => {
  function post(body: unknown) {
    return POST(
      new NextRequest("http://localhost/api/accounts/reconcile", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  }

  it("400s on an invalid account reference or missing statement date", async () => {
    const res = await post({ account: "cash:x", statement_date: "2026-08-31", statement_balance: 1 });
    expect(res.status).toBe(400);
    const res2 = await post({ account: `plaid:${ACC_ID}`, statement_balance: 1 });
    expect(res2.status).toBe(400);
  });

  it("treats absent cleared_ids as an empty list", async () => {
    mockTables({
      accounts: { data: { ...PLAID_ACCOUNT, current_balance: 1930 } },
      transactions: { data: [] },
      transaction_annotations: { data: [] },
      account_reconciliations: { data: [{ id: "stmt-1" }] },
    });
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
    });
    expect(res.status).toBe(200);
  });

  it("rejects oversized cleared_ids lists", async () => {
    const many = Array.from({ length: 1001 }, () => T1);
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1,
      cleared_ids: many,
    });
    expect(res.status).toBe(400);
  });

  it("ignores non-string entries in cleared_ids", async () => {
    mockTables({
      accounts: { data: { ...PLAID_ACCOUNT, current_balance: 1930 } },
      transactions: { data: [{ id: T1 }] },
      transaction_annotations: { data: [] },
      account_reconciliations: { data: [{ id: "stmt-1" }] },
    });
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [T1, 42, null, ""],
    });
    expect(res.status).toBe(200);
  });

  it("supports a liability account adjustment (credit card)", async () => {
    const writes: Array<{ op: string; args: unknown[] }> = [];
    mockTables({
      accounts: { data: { ...PLAID_ACCOUNT, type: "credit", current_balance: -500 } },
      transactions: { data: [] },
      transaction_annotations: { data: [] },
      account_reconciliations: {
        data: [{ id: "stmt-1" }],
        onWrite: (op, args) => writes.push({ op, args }),
      },
    });
    // Card owes 500, statement says 450: difference -50; liability direction 1
    // wants the ledger to show 50 MORE owed: adjustment = -direction × diff = 50.
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: -450,
      cleared_ids: [],
      create_adjustment: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { adjustment_amount: number };
    expect(body.adjustment_amount).toBe(50);
  });

  it("uses the default adjustment label when no note is given", async () => {
    const writes: Array<{ op: string; args: unknown[] }> = [];
    mockTables({
      accounts: { data: { ...PLAID_ACCOUNT, current_balance: 1980 } },
      transactions: {
        data: [],
        onWrite: (op, args) => writes.push({ op, args }),
      },
      account_reconciliations: { data: [{ id: "stmt-1" }] },
    });
    const res = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [],
      create_adjustment: true,
    });
    expect(res.status).toBe(200);
    const insert = writes.find((w) => w.op === "insert");
    const row = insert!.args[0] as Record<string, unknown>;
    expect(row.name).toBe("Balance adjustment");
  });

  it("surfaces ownership-check, upsert, unmark, and adjustment failures", async () => {
    const err = { message: "boom", code: "P0001" };
    // Ownership read failure.
    mockTables({
      accounts: { data: { ...PLAID_ACCOUNT, current_balance: 1930 } },
      transactions: { error: err },
    });
    const res1 = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [T1],
    });
    expect(res1.status).toBe(500);

    // Upsert failure.
    mockTables({
      accounts: { data: { ...PLAID_ACCOUNT, current_balance: 1930 } },
      transactions: { data: [{ id: T1 }] },
      transaction_annotations: { error: err },
    });
    const res2 = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [T1],
    });
    expect(res2.status).toBe(500);

    // Unmark failure.
    mockTables({
      accounts: { data: { ...PLAID_ACCOUNT, current_balance: 1930 } },
      transactions: { data: [{ id: T1 }, { id: T2 }] },
      transaction_annotations: { error: err },
      account_reconciliations: { data: [{ id: "stmt-1" }] },
    });
    const res3 = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [],
      create_adjustment: true,
    });
    expect(res3.status).toBe(500);

    // Adjustment insert failure.
    mockTables({
      accounts: { data: { ...PLAID_ACCOUNT, current_balance: 1980 } },
      transactions: { error: err },
      account_reconciliations: { data: [{ id: "stmt-1" }] },
    });
    const res4 = await post({
      account: `plaid:${ACC_ID}`,
      statement_date: "2026-08-31",
      statement_balance: 1930,
      cleared_ids: [],
      create_adjustment: true,
    });
    expect(res4.status).toBe(500);
  });
});
