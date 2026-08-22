import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub, queryStub, type QueryResult } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) =>
    NextResponse.json(
      { error: error instanceof Error ? error.message : "error" },
      { status: 500 },
    ),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(() => true);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

import { POST as savedPost, PATCH as savedPatch } from "@/app/api/reports/saved/route";
import { POST as tokensPost, DELETE as tokensDelete } from "@/app/api/tokens/route";
import { POST as cancelledPost, DELETE as cancelledDelete } from "@/app/api/subscriptions/cancelled/route";

const USER = "user-1";
const REPORT_ID = "123e4567-e89b-12d3-a456-426614174000";

const filters = {
  version: 1,
  start: "2026-07-01",
  end: "2026-07-31",
  tab: "cash_flow",
  mode: "breakdown",
  dimension: "category",
  scope: null,
  accounts: [],
  merchants: [],
  categories: [],
  excludePending: false,
};

function jsonReq(url: string, method: string, payload: unknown) {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
}

/** A client whose successive `from()` calls resolve differently, for routes
 *  that query one table twice (the cap count, then the write). */
function sequencedClient(results: Array<{ data?: unknown; error?: unknown; count?: number | null }>) {
  const stubs = results.map((result) => queryStub(result as QueryResult));
  let index = 0;
  return {
    from: vi.fn(() => stubs[Math.min(index++, stubs.length - 1)]!),
    stubs,
  };
}

function authWith(supabase: unknown) {
  mockRequireUser.mockResolvedValue({
    user: { id: USER },
    supabase: supabase as never,
  } as never);
}

describe("coverage-boost export routes (n2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
    mockGetDefaultClient();
  });

  function mockGetDefaultClient() {
    return clientStub();
  }

  describe("reports/saved POST", () => {
    it("falls back to zero when the count is null, then saves", async () => {
      const sequenced = sequencedClient([
        { count: null, error: null },
        { data: { id: REPORT_ID, name: "July", report_type: "cash_flow", filters }, error: null },
      ]);
      authWith(sequenced);
      const res = await savedPost(
        jsonReq("http://localhost/api/reports/saved", "POST", {
          name: "July",
          reportType: "cash_flow",
          filters,
        }),
      );
      expect(res.status).toBe(200);
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "saved_report_created" }),
      );
    });

    it("surfaces a non-duplicate insert error as a 500", async () => {
      const sequenced = sequencedClient([
        { count: 0, error: null },
        { data: null, error: new Error("insert failed") },
      ]);
      authWith(sequenced);
      const res = await savedPost(
        jsonReq("http://localhost/api/reports/saved", "POST", {
          name: "July",
          reportType: "cash_flow",
          filters,
        }),
      );
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith(
        "reports.saved.post",
        expect.any(Error),
      );
    });
  });

  describe("reports/saved PATCH", () => {
    it("surfaces a non-duplicate update error as a 500", async () => {
      const client = clientStub({
        saved_reports: { data: null, error: new Error("update failed") },
      });
      authWith(client);
      const res = await savedPatch(
        jsonReq("http://localhost/api/reports/saved", "PATCH", {
          id: REPORT_ID,
          name: "August",
        }),
      );
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith(
        "reports.saved.patch",
        expect.any(Error),
      );
    });

    it("patches successfully and audits the update", async () => {
      const client = clientStub({
        saved_reports: { data: { id: REPORT_ID, name: "August", report_type: "cash_flow", filters }, error: null },
      });
      authWith(client);
      const res = await savedPatch(
        jsonReq("http://localhost/api/reports/saved", "PATCH", {
          id: REPORT_ID,
          name: "August",
        }),
      );
      expect(res.status).toBe(200);
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "saved_report_updated" }),
      );
    });
  });

  describe("tokens POST", () => {
    it("surfaces an insert error as a 500", async () => {
      const client = clientStub({
        api_tokens: { data: null, error: new Error("insert failed") },
      });
      authWith(client);
      const res = await tokensPost(
        jsonReq("http://localhost/api/tokens", "POST", { name: "scripts" }),
      );
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith(
        "tokens.create",
        expect.any(Error),
      );
    });
  });

  describe("tokens DELETE", () => {
    it("surfaces a revoke error as a 500", async () => {
      const client = clientStub({
        api_tokens: { data: null, error: new Error("revoke failed") },
      });
      authWith(client);
      const res = await tokensDelete(
        jsonReq("http://localhost/api/tokens", "DELETE", { id: "t1" }),
      );
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith(
        "tokens.revoke",
        expect.any(Error),
      );
    });
  });

  describe("subscriptions/cancelled", () => {
    it("returns the auth response on POST when signed out", async () => {
      mockRequireUser.mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const res = await cancelledPost(
        jsonReq("http://localhost/api/subscriptions/cancelled", "POST", {
          merchant: "Netflix",
        }),
      );
      expect(res.status).toBe(401);
    });

    it("returns the auth response on DELETE when signed out", async () => {
      mockRequireUser.mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const res = await cancelledDelete(
        jsonReq("http://localhost/api/subscriptions/cancelled", "DELETE", {
          merchant: "Netflix",
        }),
      );
      expect(res.status).toBe(401);
    });

    it("surfaces a delete error as a 500", async () => {
      const client = clientStub({
        cancelled_subscriptions: { data: null, error: new Error("delete failed") },
      });
      authWith(client);
      const res = await cancelledDelete(
        jsonReq("http://localhost/api/subscriptions/cancelled", "DELETE", {
          merchant: "Netflix",
        }),
      );
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith(
        "subscriptions.cancelled.remove",
        expect.any(Error),
      );
    });
  });
});