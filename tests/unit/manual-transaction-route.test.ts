import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) => {
    throw error;
  },
}));

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

const mockWriteAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

const mockAnnotatePost = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
vi.mock("@/app/api/transactions/annotate/route", () => ({
  POST: (...args: unknown[]) => mockAnnotatePost(...args),
}));

let flagEnabled = true;
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => flagEnabled,
}));

import { POST, DELETE } from "@/app/api/transactions/manual/route";

const USER_ID = "user-1";

function request(method: string, body: unknown) {
  return new NextRequest("http://localhost/api/transactions/manual", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  flagEnabled = true;
  serviceClient = clientStub({
    transactions: { data: { id: "txn-1" }, error: null },
  });
});

describe("POST /api/transactions/manual", () => {
  it("404s while transactionsParity is off, before touching auth", async () => {
    flagEnabled = false;
    const res = await POST(request("POST", {}));
    expect(res.status).toBe(404);
    expect(mockRequireUser).not.toHaveBeenCalled();
  });

  it("returns the authentication response", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireUser.mockResolvedValue(unauthorized);
    await expect(POST(request("POST", {}))).resolves.toBe(unauthorized);
  });

  it("400s an invalid body before touching the database", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: clientStub() });
    const res = await POST(request("POST", { kind: "debit", amount: -1 }));
    expect(res.status).toBe(400);
  });

  it("404s when the chosen account is not the caller's", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ manual_accounts: { data: null, error: null } }),
    });
    const res = await POST(
      request("POST", {
        kind: "debit",
        amount: 10,
        merchant: "Store",
        date: "2026-07-01",
        account: { source: "manual", id: "not-mine" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("creates a manual transaction with the manual- prefix and source column", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ manual_accounts: { data: { id: "man-1" }, error: null } }),
    });
    const res = await POST(
      request("POST", {
        kind: "debit",
        amount: 10,
        merchant: "Store",
        date: "2026-07-01",
        account: { source: "manual", id: "man-1" },
      }),
    );
    expect(res.status).toBe(201);
    const written = serviceClient.writtenTo("transactions") as Record<string, unknown>;
    expect(written).toMatchObject({
      user_id: USER_ID,
      manual_account_id: "man-1",
      account_id: null,
      amount: 10,
      source: "manual",
    });
    expect(written.plaid_transaction_id).toMatch(/^manual-/);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_transaction_created" }),
    );
    expect(mockAnnotatePost).not.toHaveBeenCalled();
  });

  it("stores a credit as a negative signed amount", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ manual_accounts: { data: { id: "man-1" }, error: null } }),
    });
    await POST(
      request("POST", {
        kind: "credit",
        amount: 10,
        merchant: "Refund",
        date: "2026-07-01",
        account: { source: "manual", id: "man-1" },
      }),
    );
    const written = serviceClient.writtenTo("transactions") as Record<string, unknown>;
    expect(written.amount).toBe(-10);
  });

  it("reuses the Phase 7 annotate route to link a goal or attach notes", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ manual_accounts: { data: { id: "man-1" }, error: null } }),
    });
    await POST(
      request("POST", {
        kind: "debit",
        amount: 10,
        merchant: "Store",
        date: "2026-07-01",
        account: { source: "manual", id: "man-1" },
        goalId: "goal-1",
        notes: "for the trip",
      }),
    );
    expect(mockAnnotatePost).toHaveBeenCalledTimes(1);
    const [linkRequest] = mockAnnotatePost.mock.calls[0] as [NextRequest];
    const linkBody = await linkRequest.json();
    expect(linkBody).toMatchObject({ transaction_id: "txn-1", goal_id: "goal-1", note: "for the trip" });
  });
});

describe("DELETE /api/transactions/manual", () => {
  it("404s while transactionsParity is off, before touching auth", async () => {
    flagEnabled = false;
    const res = await DELETE(request("DELETE", { id: "t1" }));
    expect(res.status).toBe(404);
    expect(mockRequireUser).not.toHaveBeenCalled();
  });

  it("404s a transaction that is not source=manual", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ transactions: { data: { id: "t1", source: "plaid" }, error: null } }),
    });
    const res = await DELETE(request("DELETE", { id: "t1" }));
    expect(res.status).toBe(404);
  });

  it("deletes a manual transaction scoped to the caller and audits it", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ transactions: { data: { id: "t1", source: "manual" }, error: null } }),
    });
    const res = await DELETE(request("DELETE", { id: "t1" }));
    expect(res.status).toBe(200);
    expect(serviceClient.scopedToUser("transactions", USER_ID)).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_transaction_deleted" }),
    );
  });
});
