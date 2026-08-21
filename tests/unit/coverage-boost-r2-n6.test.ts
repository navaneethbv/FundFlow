import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) =>
    NextResponse.json({ error: String(error) }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const svc = vi.hoisted(() => ({
  securitySingle: null as unknown,
  holdingSingle: null as unknown,
  snapshotInsert: null as unknown,
  holdingDelete: null as unknown,
  securityPayload: null as unknown,
  holdingPayload: null as unknown,
  snapshotPayload: null as unknown,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "securities") {
        return {
          insert: (payload: unknown) => {
            svc.securityPayload = payload;
            return { select: () => ({ single: svc.securitySingle }) };
          },
        };
      }
      if (table === "holdings") {
        return {
          insert: (payload: unknown) => {
            svc.holdingPayload = payload;
            return { select: () => ({ single: svc.holdingSingle }) };
          },
          delete: () => ({ eq: () => ({ eq: () => ({ eq: svc.holdingDelete }) }) }),
        };
      }
      if (table === "holding_snapshots") {
        return {
          insert: (payload: unknown) => {
            svc.snapshotPayload = payload;
            return {};
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

import { POST, DELETE } from "@/app/api/investments/manual/route";

function postReq(body: unknown): NextRequest {
  return new NextRequest("https://x.local/api/investments/manual", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const VALID_PLAID = {
  accountSource: "plaid",
  accountId: "acc-1",
  securityName: "Apple Inc.",
  ticker: "AAPL",
  securityType: "equity",
  quantity: 10,
  price: 150.5,
  asOf: "2026-07-01",
  currency: "USD",
};

describe("POST /api/investments/manual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.securitySingle = vi.fn().mockResolvedValue({ data: { id: "sec-1" }, error: null });
    svc.holdingSingle = vi.fn().mockResolvedValue({ data: { id: "hold-1" }, error: null });
    svc.holdingDelete = vi.fn().mockResolvedValue({ error: null });
    svc.securityPayload = null;
    svc.holdingPayload = null;
    svc.snapshotPayload = null;
  });

  it("passes through the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await POST(postReq(VALID_PLAID));
    expect(res.status).toBe(401);
  });

  it("falls back to null body and rejects it", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(
      new NextRequest("https://x.local/api/investments/manual", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith(
      "accountSource must be 'plaid' or 'manual'",
    );
  });

  it("rejects invalid normalization input", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    for (const body of [
      {},
      { accountSource: "plaid", accountId: "" },
      { accountSource: "plaid", accountId: "a1", securityName: "X", quantity: 0 },
      { accountSource: "plaid", accountId: "a1", securityName: "X", quantity: 1, price: -1 },
      { accountSource: "plaid", accountId: "a1", securityName: "X", quantity: 1, price: 1, asOf: "not-a-date" },
      { accountSource: "plaid", accountId: "a1", securityName: "X", quantity: 1, price: 1, asOf: "2999-01-01" },
    ]) {
      const res = await POST(postReq(body));
      expect(res.status).toBe(400);
    }
  });

  it("creates a plaid-backed manual holding and audits", async () => {
    const client = clientStub({
      accounts: { data: { id: "acc-1" }, error: null },
      manual_accounts: { data: null, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });

    const res = await POST(postReq(VALID_PLAID));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ id: "hold-1" });

    expect(svc.securityPayload).toEqual({
      user_id: "u1",
      name: "Apple Inc.",
      ticker: "AAPL",
      security_type: "equity",
      iso_currency_code: "USD",
    });
    expect(svc.holdingPayload).toEqual(
      expect.objectContaining({
        user_id: "u1",
        account_id: "acc-1",
        manual_account_id: null,
        security_id: "sec-1",
        quantity: 10,
        institution_price: 150.5,
        institution_value: 1505,
        as_of: "2026-07-01",
        source: "manual",
        is_active: true,
      }),
    );
    expect(svc.snapshotPayload).toEqual(
      expect.objectContaining({
        holding_id: "hold-1",
        snapshot_date: "2026-07-01",
        quantity: 10,
        price: 150.5,
        value: 1505,
      }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "manual_holding_created",
        metadata: expect.objectContaining({ holding_id: "hold-1" }),
      }),
    );
  });

  it("returns 404 when the source account is not found", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ accounts: { data: null, error: null } }),
    });
    const res = await POST(postReq(VALID_PLAID));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Account not found" });
  });

  it("throws through errorResponse when the account lookup fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ accounts: { data: null, error: new Error("lookup failed") } }),
    });
    const res = await POST(postReq(VALID_PLAID));
    expect(res.status).toBe(500);
  });

  it("creates a manual-account holding with manual account ids", async () => {
    const client = clientStub({
      manual_accounts: { data: { id: "m-1" }, error: null },
      accounts: { data: null, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });

    const res = await POST(
      postReq({ ...VALID_PLAID, accountSource: "manual", accountId: "m-1" }),
    );
    expect(res.status).toBe(201);
    expect(svc.holdingPayload).toEqual(
      expect.objectContaining({
        account_id: null,
        manual_account_id: "m-1",
      }),
    );
    expect(svc.snapshotPayload).toBeTruthy();
  });

  it("throws through errorResponse when the security insert fails", async () => {
    svc.securitySingle = vi.fn().mockResolvedValue({ data: null, error: new Error("sec failed") });
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ accounts: { data: { id: "acc-1" }, error: null } }),
    });
    const res = await POST(postReq(VALID_PLAID));
    expect(res.status).toBe(500);
  });

  it("throws through errorResponse when the holding insert fails", async () => {
    svc.holdingSingle = vi.fn().mockResolvedValue({ data: null, error: new Error("hold failed") });
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ accounts: { data: { id: "acc-1" }, error: null } }),
    });
    const res = await POST(postReq(VALID_PLAID));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/investments/manual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.holdingDelete = vi.fn().mockResolvedValue({ error: null });
  });

  function deleteReq(body: unknown): NextRequest {
    return new NextRequest("https://x.local/api/investments/manual", {
      method: "DELETE",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("passes through the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await DELETE(deleteReq({ id: "hold-1" }));
    expect(res.status).toBe(401);
  });

  it("rejects a missing, non-string, or blank id", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    for (const body of [{}, { id: 42 }, { id: "" }]) {
      const res = await DELETE(deleteReq(body));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("id is required");
    }
  });

  it("falls back to null body and rejects it", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const res = await DELETE(
      new NextRequest("https://x.local/api/investments/manual", {
        method: "DELETE",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the holding is not manual", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        holdings: { data: { id: "hold-1", source: "plaid" }, error: null },
      }),
    });
    const res = await DELETE(deleteReq({ id: "hold-1" }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Manual holding not found" });
  });

  it("throws through errorResponse when the lookup fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ holdings: { data: null, error: new Error("find failed") } }),
    });
    const res = await DELETE(deleteReq({ id: "hold-1" }));
    expect(res.status).toBe(500);
  });

  it("deletes the manual holding and audits", async () => {
    const client = clientStub({
      holdings: { data: { id: "hold-1", source: "manual" }, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await DELETE(deleteReq({ id: "hold-1" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(svc.holdingDelete).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "manual_holding_deleted",
        metadata: expect.objectContaining({ holding_id: "hold-1" }),
      }),
    );
  });

  it("throws through errorResponse when the delete fails", async () => {
    svc.holdingDelete = vi.fn().mockResolvedValue({ error: new Error("delete failed") });
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        holdings: { data: { id: "hold-1", source: "manual" }, error: null },
      }),
    });
    const res = await DELETE(deleteReq({ id: "hold-1" }));
    expect(res.status).toBe(500);
  });
});