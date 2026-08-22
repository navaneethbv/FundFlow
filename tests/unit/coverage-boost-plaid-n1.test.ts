import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockRequireAdmin = vi.fn<(...args: unknown[]) => unknown>();
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_ctx: unknown, error: unknown) =>
    NextResponse.json({ error: (error as Error).message }, { status: 500 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  requireAdmin: () => mockRequireAdmin(),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(
  () => Promise.resolve(true),
);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockListActiveItems = vi.fn<(...args: unknown[]) => unknown>(() => []);
const mockDecryptItemToken = vi.fn<(...args: unknown[]) => unknown>(
  () => "decrypted-token",
);
vi.mock("@/lib/plaid-service", () => ({
  listActiveItems: (...args: unknown[]) => mockListActiveItems(...args),
  decryptItemToken: (...args: unknown[]) => mockDecryptItemToken(...args),
}));

const mockItemRemove = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({ itemRemove: (...args: unknown[]) => mockItemRemove(...args) }),
}));

const mockLogError = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

import { DELETE as accountDelete } from "@/app/api/account/route";
import { POST as aprPost } from "@/app/api/accounts/apr/route";
import { GET as statsGet } from "@/app/api/admin/stats/route";

const baseUser = { id: "user-1", email: "user@example.com" };

describe("coverage-boost-plaid-n1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceClient = clientStub();
    mockCheckRateLimit.mockResolvedValue(true);
    mockListActiveItems.mockResolvedValue([]);
    mockItemRemove.mockResolvedValue({ data: {} });
  });

  describe("DELETE /api/account", () => {
    it("returns auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(
        new NextResponse("unauthorized", { status: 401 }),
      );
      const res = await accountDelete({} as NextRequest);
      expect(res.status).toBe(401);
    });

    it("returns bad request when the body is invalid JSON", async () => {
      mockRequireUser.mockResolvedValue({
        user: baseUser,
        supabase: { auth: { mfa: { listFactors: vi.fn(), signInWithPassword: vi.fn() } } },
      });
      const req = new NextRequest("http://localhost/api/account", {
        method: "DELETE",
        body: "not json",
      });
      const res = await accountDelete(req);
      expect(res.status).toBe(400);
    });

    it("covers the TOTP failure branch (verified factor returns an error)", async () => {      mockRequireUser.mockResolvedValue({
        user: baseUser,
        supabase: {
          auth: {
            mfa: {
              listFactors: vi.fn().mockResolvedValue({
                data: { totp: [{ id: "f1", status: "verified" }], phone: [] },
              }),
              challengeAndVerify: vi.fn().mockResolvedValue({
                error: { message: "bad code" },
              }),
            },
            signInWithPassword: vi.fn(),
          },
        },
      });
      const req = new NextRequest("http://localhost/api/account", {
        method: "DELETE",
        body: JSON.stringify({ code: "123456" }),
      });
      const res = await accountDelete(req);
      expect(res.status).toBe(401);
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "account_delete_failed" }),
      );
    });

    it("covers the TOTP success branch (challengeAndVerify returns no error)", async () => {
      serviceClient = {
        ...clientStub(),
        auth: {
          admin: { deleteUser: vi.fn().mockResolvedValue({ error: null }) },
        },
      } as unknown as typeof serviceClient;
      mockRequireUser.mockResolvedValue({
        user: baseUser,
        supabase: {
          auth: {
            mfa: {
              listFactors: vi.fn().mockResolvedValue({
                data: { totp: [{ id: "f1", status: "verified" }], phone: [] },
              }),
              challengeAndVerify: vi.fn().mockResolvedValue({ error: null }),
            },
            signInWithPassword: vi.fn(),
          },
        },
      });
      const req = new NextRequest("http://localhost/api/account", {
        method: "DELETE",
        body: JSON.stringify({ code: "123456" }),
      });
      const res = await accountDelete(req);
      expect(res.status).toBe(200);
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "account_delete" }),
      );
    });
  });

  describe("POST /api/accounts/apr", () => {
    const ownershipSupabase = (single: unknown) => ({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(single),
      }),
    });

    it("returns auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(
        new NextResponse("unauthorized", { status: 401 }),
      );
      const res = await aprPost({} as NextRequest);
      expect(res.status).toBe(401);
    });

    it("returns bad request when the body is invalid JSON", async () => {
      mockRequireUser.mockResolvedValue({ user: baseUser, supabase: ownershipSupabase({ data: { id: "a1" } }) });
      const req = new NextRequest("http://localhost/api/accounts/apr", {
        method: "POST",
        body: "not json",
      });
      const res = await aprPost(req);
      expect(res.status).toBe(400);
    });

    it("returns bad request when accountId is missing", async () => {
      mockRequireUser.mockResolvedValue({ user: baseUser, supabase: ownershipSupabase({ data: { id: "a1" } }) });
      const req = new NextRequest("http://localhost/api/accounts/apr", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await aprPost(req);
      expect(res.status).toBe(400);
    });

    it("returns bad request for an invalid apr", async () => {
      mockRequireUser.mockResolvedValue({ user: baseUser, supabase: ownershipSupabase({ data: { id: "a1" } }) });
      const req = new NextRequest("http://localhost/api/accounts/apr", {
        method: "POST",
        body: JSON.stringify({ accountId: "a1", apr: 200 }),
      });
      const res = await aprPost(req);
      expect(res.status).toBe(400);
    });

    it("returns 404 when the account is not owned", async () => {
      mockRequireUser.mockResolvedValue({ user: baseUser, supabase: ownershipSupabase({ data: null }) });
      const req = new NextRequest("http://localhost/api/accounts/apr", {
        method: "POST",
        body: JSON.stringify({ accountId: "a1", apr: 5 }),
      });
      const res = await aprPost(req);
      expect(res.status).toBe(404);
    });

    it("updates apr successfully and audits", async () => {
      mockRequireUser.mockResolvedValue({ user: baseUser, supabase: ownershipSupabase({ data: { id: "a1" } }) });
      serviceClient = clientStub({ accounts: { error: null } });
      const req = new NextRequest("http://localhost/api/accounts/apr", {
        method: "POST",
        body: JSON.stringify({ accountId: "a1", apr: 5 }),
      });
      const res = await aprPost(req);
      expect(res.status).toBe(200);
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "apr_updated" }),
      );
    });

    it("returns errorResponse when the service update fails", async () => {
      mockRequireUser.mockResolvedValue({ user: baseUser, supabase: ownershipSupabase({ data: { id: "a1" } }) });
      serviceClient = clientStub({ accounts: { error: { message: "DB down" } } });
      const req = new NextRequest("http://localhost/api/accounts/apr", {
        method: "POST",
        body: JSON.stringify({ accountId: "a1", apr: null }),
      });
      const res = await aprPost(req);
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/admin/stats", () => {
    it("returns counts when present", async () => {
      mockRequireAdmin.mockResolvedValue({ user: baseUser });
      serviceClient = clientStub({
        plaid_items: { count: 3 },
        accounts: { count: 5 },
        transactions: { count: 7 },
      });
      const res = await statsGet();
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        plaid_items: 3,
        accounts: 5,
        transactions: 7,
      });
    });

    it("falls back to 0 when a count is absent", async () => {
      mockRequireAdmin.mockResolvedValue({ user: baseUser });
      serviceClient = clientStub();
      const res = await statsGet();
      await expect(res.json()).resolves.toEqual({
        plaid_items: 0,
        accounts: 0,
        transactions: 0,
      });
    });

    it("returns auth response when not an admin", async () => {
      mockRequireAdmin.mockResolvedValue(
        new NextResponse("forbidden", { status: 403 }),
      );
      const res = await statsGet();
      expect(res.status).toBe(403);
    });
  });
});
