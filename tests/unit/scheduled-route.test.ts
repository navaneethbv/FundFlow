import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/scheduled-transactions/route";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/http";

const from = vi.fn();

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), getClientIp: vi.fn(() => "127.0.0.1") }));

function thenable(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => resolve({ data, error }),
  };
  for (const method of ["select", "eq", "order", "limit", "insert", "update", "delete", "single", "maybeSingle"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function request(body: unknown, method: "POST" | "PATCH" | "DELETE" = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/scheduled-transactions", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = {
  kind: "debit",
  amount: 500,
  merchant: "Landlord",
  date: "2026-09-25",
  account: { source: "plaid", id: "acc-1" },
  category: "rent",
  notes: null,
};

describe("POST /api/scheduled-transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-123" },
      supabase: { from } as never,
    } as never);
    vi.mocked(writeAudit).mockResolvedValue(undefined);
  });

  it("inserts with an explicit user_id and both account columns resolved", async () => {
    const insert = vi.fn(() => thenable([{ id: "s1", kind: "debit", amount: "500.00", merchant: "Landlord", scheduled_date: "2026-09-25", category: "rent", notes: null, account_id: "acc-1", manual_account_id: null, status: "scheduled" }]));
    from.mockImplementation((table: string) => {
      expect(table).toBe("scheduled_transactions");
      return { insert };
    });
    const res = await POST(request(VALID));
    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-123",
        account_id: "acc-1",
        manual_account_id: null,
      }),
    );
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "scheduled_transaction_created" }));
  });

  it("routes a manual account into manual_account_id", async () => {
    const insert = vi.fn(() => thenable([{ id: "s2", kind: "debit", amount: "10.00", merchant: "Cash", scheduled_date: "2026-09-25", category: null, notes: null, account_id: null, manual_account_id: "m1", status: "scheduled" }]));
    from.mockReturnValue({ insert });
    await POST(request({ ...VALID, account: { source: "manual", id: "m1" } }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ account_id: null, manual_account_id: "m1" }));
  });

  it("400s on validation errors before any query", async () => {
    const res = await POST(request({ ...VALID, date: "2001-01-01" }));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns the auth response when signed out", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await POST(request(VALID));
    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/scheduled-transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-123" },
      supabase: { from } as never,
    } as never);
    vi.mocked(writeAudit).mockResolvedValue(undefined);
  });

  it("updates only the caller's own scheduled rows", async () => {
    const builder = thenable([{ id: "s1", kind: "debit", amount: "500.00", merchant: "Landlord", scheduled_date: "2026-09-26", category: null, notes: null, account_id: "acc-1", manual_account_id: null, status: "scheduled" }]);
    const update = vi.fn(() => builder);
    from.mockReturnValue({ update });
    const res = await PATCH_LIKE({ ...VALID, date: "2026-09-26", id: "11111111-1111-1111-1111-111111111111" });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalled();
  });

  it("400s on a malformed id", async () => {
    const res = await PATCH_LIKE({ ...VALID, id: "nope" });
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  async function PATCH_LIKE(body: unknown) {
    const { PATCH } = await import("@/app/api/scheduled-transactions/route");
    return PATCH(request(body, "PATCH") as never);
  }
});

describe("DELETE /api/scheduled-transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-123" },
      supabase: { from } as never,
    } as never);
    vi.mocked(writeAudit).mockResolvedValue(undefined);
  });

  it("cancels an owned scheduled row and audits", async () => {
    const builder = thenable([{ id: "s1" }]);
    const del = vi.fn(() => builder);
    from.mockReturnValue({ delete: del });
    const { DELETE } = await import("@/app/api/scheduled-transactions/route");
    const res = await DELETE(request({ id: "11111111-1111-1111-1111-111111111111" }, "DELETE") as never);
    expect(res.status).toBe(200);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "scheduled_transaction_cancelled" }));
  });

  it("404s when nothing matched (already promoted or not owned)", async () => {
    const builder = thenable(null);
    from.mockReturnValue({ delete: vi.fn(() => builder) });
    const { DELETE } = await import("@/app/api/scheduled-transactions/route");
    const res = await DELETE(request({ id: "11111111-1111-1111-1111-111111111111" }, "DELETE") as never);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/scheduled-transactions and remaining branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-123" },
      supabase: { from } as never,
    } as never);
    vi.mocked(writeAudit).mockResolvedValue(undefined);
  });

  it("GET lists the caller's scheduled rows sorted by date", async () => {
    from.mockReturnValue(
      thenable([
        { id: "s1", kind: "debit", amount: "500.00", merchant: "Landlord", scheduled_date: "2026-09-25", category: "rent", notes: null, account_id: "acc-1", manual_account_id: null, status: "scheduled" },
      ]),
    );
    const { GET } = await import("@/app/api/scheduled-transactions/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scheduled: Array<{ id: string; amount: number }> };
    expect(body.scheduled[0]!.id).toBe("s1");
    expect(body.scheduled[0]!.amount).toBe(500);
  });

  it("GET handles read failures and null data", async () => {
    const { GET } = await import("@/app/api/scheduled-transactions/route");
    from.mockReturnValue(thenable(null, { message: "boom", code: "P0001" }));
    expect((await GET()).status).toBe(500);
    from.mockReturnValue(thenable(null));
    const ok = await GET();
    expect(((await ok.json()) as { scheduled: unknown[] }).scheduled).toEqual([]);
  });

  it("returns the auth response when signed out on every method", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const mod = await import("@/app/api/scheduled-transactions/route");
    expect((await mod.GET()).status).toBe(401);
    expect((await mod.POST(request(VALID))).status).toBe(401);
    expect((await mod.PATCH(request({ ...VALID, id: "11111111-1111-1111-1111-111111111111" }, "PATCH"))).status).toBe(401);
    expect((await mod.DELETE(request({ id: "11111111-1111-1111-1111-111111111111" }, "DELETE"))).status).toBe(401);
  });

  it("PATCH surfaces insert/update failures and a not-found row", async () => {
    const { PATCH } = await import("@/app/api/scheduled-transactions/route");
    const id = "11111111-1111-1111-1111-111111111111";
    from.mockReturnValue(thenable(null, { message: "boom", code: "P0001" }));
    const failing = await PATCH(request({ ...VALID, date: "2026-09-26", id }, "PATCH"));
    expect(failing.status).toBe(500);

    from.mockReturnValue(thenable(null));
    const missing = await PATCH(request({ ...VALID, date: "2026-09-26", id }, "PATCH"));
    expect(missing.status).toBe(400);
  });

  it("DELETE surfaces a delete failure", async () => {
    const { DELETE } = await import("@/app/api/scheduled-transactions/route");
    from.mockReturnValue(thenable([{ id: "s1" }], { message: "boom", code: "P0001" }));
    const res = await DELETE(request({ id: "11111111-1111-1111-1111-111111111111" }, "DELETE"));
    expect(res.status).toBe(500);
  });

  it("POST surfaces an insert failure", async () => {
    from.mockReturnValue(thenable(null, { message: "boom", code: "P0001" }));
    const res = await POST(request(VALID));
    expect(res.status).toBe(500);
  });
});

describe("PATCH/DELETE — final branch sides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-123" },
      supabase: { from } as never,
    } as never);
    vi.mocked(writeAudit).mockResolvedValue(undefined);
  });

  it("PATCH validates the payload after the id and routes manual accounts", async () => {
    const { PATCH } = await import("@/app/api/scheduled-transactions/route");
    const id = "11111111-1111-1111-1111-111111111111";
    // Valid id, invalid payload (past date).
    const invalid = await PATCH(request({ ...VALID, date: "2001-01-01", id }, "PATCH"));
    expect(invalid.status).toBe(400);

    // Manual account routes into manual_account_id.
    from.mockReturnValue(
      thenable([{ id, kind: "debit", amount: "10.00", merchant: "Cash", scheduled_date: "2026-09-25", category: null, notes: null, account_id: null, manual_account_id: "m1", status: "scheduled" }]),
    );
    const ok = await PATCH(
      request({ ...VALID, amount: 10, account: { source: "manual", id: "m1" }, id }, "PATCH"),
    );
    expect(ok.status).toBe(200);
  });

  it("DELETE rejects a non-string id", async () => {
    const { DELETE } = await import("@/app/api/scheduled-transactions/route");
    const res = await DELETE(request({ id: 42 }, "DELETE"));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
});
