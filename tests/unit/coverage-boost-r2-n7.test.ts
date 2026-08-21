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
  postSingle: null as unknown,
  patchSingle: null as unknown,
  deleteResult: null as unknown,
  postPayload: null as unknown,
  patchPayload: null as unknown,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== "manual_accounts") throw new Error(`unexpected table ${table}`);
      return {
        insert: (payload: unknown) => {
          svc.postPayload = payload;
          return { select: () => ({ single: svc.postSingle }) };
        },
        update: (payload: unknown) => {
          svc.patchPayload = payload;
          return { eq: () => ({ eq: () => ({ select: () => ({ single: svc.patchSingle }) }) }) };
        },
        delete: () => ({ eq: () => ({ eq: svc.deleteResult }) }),
      };
    },
  }),
}));

const mockTrySnapshots = vi.fn<(...args: unknown[]) => unknown>(
  () => Promise.resolve(undefined),
);
vi.mock("@/lib/account-history", () => ({
  tryWriteDailyAccountSnapshots: (...args: unknown[]) => mockTrySnapshots(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

import { POST, PATCH, DELETE } from "@/app/api/manual-accounts/route";

function req(method: "POST" | "PATCH" | "DELETE", body?: unknown): NextRequest {
  return new NextRequest("https://x.local/api/manual-accounts", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ACCOUNT = {
  id: "m-1",
  name: "Emergency",
  account_type: "cash",
  balance: 1000,
  include_in_net_worth: true,
};

describe("POST /api/manual-accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.postSingle = vi.fn().mockResolvedValue({ data: ACCOUNT, error: null });
    svc.patchSingle = vi.fn().mockResolvedValue({ data: ACCOUNT, error: null });
    svc.deleteResult = vi.fn().mockResolvedValue({ error: null });
    svc.postPayload = null;
    svc.patchPayload = null;
  });

  it("passes through the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await POST(req("POST", { name: "x", accountType: "cash", balance: 1 }));
    expect(res.status).toBe(401);
  });

  it("falls back to null body and rejects the missing name", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(
      new NextRequest("https://x.local/api/manual-accounts", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith(
      "name must be between 1 and 120 characters",
    );
  });

  it("rejects a blank, overlong, or non-string name", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    for (const name of ["", "   ", "x".repeat(121), 42]) {
      const res = await POST(
        req("POST", { name, accountType: "cash", balance: 1 }),
      );
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "name must be between 1 and 120 characters",
      );
    }
  });

  it("rejects an unsupported or non-string accountType", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    for (const accountType of ["crypto", 42, undefined]) {
      const res = await POST(
        req("POST", { name: "x", accountType, balance: 1 }),
      );
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("accountType is not supported");
    }
  });

  it("rejects a non-finite or non-number balance", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    for (const balance of ["100", NaN, Infinity, null]) {
      const res = await POST(
        req("POST", { name: "x", accountType: "cash", balance }),
      );
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("balance must be a finite number");
    }
  });

  it("rejects a non-boolean includeInNetWorth", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(
      req("POST", {
        name: "x",
        accountType: "cash",
        balance: 1,
        includeInNetWorth: "yes",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("includeInNetWorth must be a boolean");
  });

  it("creates an account with an explicit includeInNetWorth", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(
      req("POST", {
        name: "  Emergency Fund  ",
        accountType: "cash",
        balance: 1000.456,
        includeInNetWorth: false,
      }),
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ account: ACCOUNT });
    expect(svc.postPayload).toEqual({
      user_id: "u1",
      name: "Emergency Fund",
      account_type: "cash",
      balance: 1000.456,
      include_in_net_worth: false,
    });
    expect(mockTrySnapshots).toHaveBeenCalledWith(
      "u1",
      "manual-accounts.create.snapshot",
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "manual_account_created",
        metadata: expect.objectContaining({ account_id: "m-1" }),
      }),
    );
  });

  it("defaults includeInNetWorth to true", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(
      req("POST", { name: "x", accountType: "asset", balance: 1 }),
    );
    expect(res.status).toBe(201);
    expect(svc.postPayload).toEqual(
      expect.objectContaining({ include_in_net_worth: true }),
    );
  });

  it("throws through errorResponse when the insert fails", async () => {
    svc.postSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "insert failed" } });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(req("POST", { name: "x", accountType: "cash", balance: 1 }));
    expect(res.status).toBe(500);
  });

  it("throws when the insert returns no row", async () => {
    svc.postSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(req("POST", { name: "x", accountType: "cash", balance: 1 }));
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/manual-accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.patchSingle = vi.fn().mockResolvedValue({ data: ACCOUNT, error: null });
    svc.patchPayload = null;
  });

  it("passes through the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await PATCH(req("PATCH", { id: "m-1", balance: 5 }));
    expect(res.status).toBe(401);
  });

  it("rejects a missing, non-string, or blank id", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    for (const body of [{ balance: 5 }, { id: 42, balance: 5 }, { id: "", balance: 5 }]) {
      const res = await PATCH(req("PATCH", body));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("id is required");
    }
  });

  it("rejects an invalid balance or inclusion value", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const resBalance = await PATCH(req("PATCH", { id: "m-1", balance: "x" }));
    expect(resBalance.status).toBe(400);

    const resInclusion = await PATCH(
      req("PATCH", { id: "m-1", balance: 5, includeInNetWorth: 1 }),
    );
    expect(resInclusion.status).toBe(400);
  });

  it("returns 404 when the account is not visible", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ manual_accounts: { data: null, error: null } }),
    });
    const res = await PATCH(req("PATCH", { id: "m-1", balance: 5 }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Manual account not found" });
  });

  it("throws through errorResponse when the ownership lookup fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        manual_accounts: { data: null, error: new Error("lookup failed") },
      }),
    });
    const res = await PATCH(req("PATCH", { id: "m-1", balance: 5 }));
    expect(res.status).toBe(500);
  });

  it("updates balance and includeInNetWorth together", async () => {
    const client = clientStub({
      manual_accounts: { data: { id: "m-1" }, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await PATCH(
      req("PATCH", { id: "m-1", balance: 500, includeInNetWorth: false }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ account: ACCOUNT });
    expect(svc.patchPayload).toEqual({ balance: 500, include_in_net_worth: false });
    expect(mockTrySnapshots).toHaveBeenCalledWith("u1", "manual-accounts.update.snapshot");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "manual_account_updated",
        metadata: expect.objectContaining({
          account_id: "m-1",
          changed_fields: ["balance", "include_in_net_worth"],
        }),
      }),
    );
  });

  it("updates only balance when inclusion is omitted", async () => {
    const client = clientStub({
      manual_accounts: { data: { id: "m-1" }, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await PATCH(req("PATCH", { id: "m-1", balance: 300 }));
    expect(res.status).toBe(200);
    expect(svc.patchPayload).toEqual({ balance: 300 });
  });

  it("throws through errorResponse when the update fails", async () => {
    svc.patchSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "update failed" } });
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ manual_accounts: { data: { id: "m-1" }, error: null } }),
    });
    const res = await PATCH(req("PATCH", { id: "m-1", balance: 5 }));
    expect(res.status).toBe(500);
  });

  it("throws when the update returns no row", async () => {
    svc.patchSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ manual_accounts: { data: { id: "m-1" }, error: null } }),
    });
    const res = await PATCH(req("PATCH", { id: "m-1", balance: 5 }));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/manual-accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.deleteResult = vi.fn().mockResolvedValue({ error: null });
  });

  it("passes through the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await DELETE(req("DELETE", { id: "m-1" }));
    expect(res.status).toBe(401);
  });

  it("rejects a missing, non-string, or blank id", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    for (const body of [{}, { id: 42 }, { id: "" }]) {
      const res = await DELETE(req("DELETE", body));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("id is required");
    }
  });

  it("returns 404 when the account is not visible", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ manual_accounts: { data: null, error: null } }),
    });
    const res = await DELETE(req("DELETE", { id: "m-1" }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Manual account not found" });
  });

  it("throws through errorResponse when the ownership lookup fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        manual_accounts: { data: null, error: new Error("lookup failed") },
      }),
    });
    const res = await DELETE(req("DELETE", { id: "m-1" }));
    expect(res.status).toBe(500);
  });

  it("deletes the account and audits", async () => {
    const client = clientStub({
      manual_accounts: { data: { id: "m-1" }, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await DELETE(req("DELETE", { id: "m-1" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(svc.deleteResult).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "manual_account_deleted",
        metadata: expect.objectContaining({ account_id: "m-1" }),
      }),
    );
  });

  it("throws through errorResponse when the delete fails", async () => {
    svc.deleteResult = vi.fn().mockResolvedValue({ error: new Error("delete failed") });
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ manual_accounts: { data: { id: "m-1" }, error: null } }),
    });
    const res = await DELETE(req("DELETE", { id: "m-1" }));
    expect(res.status).toBe(500);
  });
});