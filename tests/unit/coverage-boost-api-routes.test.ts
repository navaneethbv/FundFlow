import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as tagsPost, PATCH as tagsPatch, DELETE as tagsDelete } from "@/app/api/settings/tags/route";
import { POST as manualInvPost, DELETE as manualInvDelete } from "@/app/api/investments/manual/route";
import { POST as demoPost, DELETE as demoDelete } from "@/app/api/demo/route";
import { GET as calendarGet } from "@/app/api/calendar/[token]/route";
import { POST as annotateBatchPost } from "@/app/api/transactions/annotate-batch/route";
import { POST as manualTxPost, DELETE as manualTxDelete } from "@/app/api/transactions/manual/route";
import { POST as savedReportPost, DELETE as savedReportDelete } from "@/app/api/reports/saved/route";
import * as http from "@/lib/http";
import * as featureFlags from "@/lib/feature-flags";

vi.mock("@/lib/audit", () => ({
  getClientIp: () => "127.0.0.1",
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

describe("Coverage Boost API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(featureFlags, "isFeatureEnabled").mockReturnValue(true);
  });

  describe("Tags Route Extra Branches", () => {
    it("returns 404 when settingsIa feature is disabled on PATCH and DELETE", async () => {
      vi.spyOn(featureFlags, "isFeatureEnabled").mockReturnValue(false);
      const req = new NextRequest("http://localhost/api/settings/tags");
      expect((await tagsPatch(req)).status).toBe(404);
      expect((await tagsDelete(req)).status).toBe(404);
    });

    it("returns 401 on unauthorized calls", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const req = new NextRequest("http://localhost/api/settings/tags", { method: "POST" });
      expect((await tagsPost(req)).status).toBe(401);
      expect((await tagsPatch(req)).status).toBe(401);
      expect((await tagsDelete(req)).status).toBe(401);
    });

    it("handles database errors and exceptions in POST, PATCH, DELETE", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: new Error("DB insert error") }),
            }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: new Error("DB select error") }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: new Error("DB delete error") }),
            }),
          }),
        }),
        rpc: vi.fn().mockResolvedValue({ error: new Error("RPC error") }),
      } as never;

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: mockSupabase,
      });

      const postReq = new NextRequest("http://localhost/api/settings/tags", {
        method: "POST",
        body: JSON.stringify({ name: "vacation" }),
      });
      expect((await tagsPost(postReq)).status).toBe(500);

      const patchReq = new NextRequest("http://localhost/api/settings/tags", {
        method: "PATCH",
        body: JSON.stringify({ oldName: "work", newName: "job" }),
      });
      expect((await tagsPatch(patchReq)).status).toBe(500);

      const deleteReq = new NextRequest("http://localhost/api/settings/tags", {
        method: "DELETE",
        body: JSON.stringify({ name: "vacation" }),
      });
      expect((await tagsDelete(deleteReq)).status).toBe(500);
    });

    it("handles invalid payloads in DELETE and PATCH", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ name: "work" }], error: null }),
          }),
        }),
      } as never;
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: mockSupabase,
      });
      const delReq = new NextRequest("http://localhost/api/settings/tags", {
        method: "DELETE",
        body: "invalid-json",
      });
      expect((await tagsDelete(delReq)).status).toBe(400);

      const patchReq = new NextRequest("http://localhost/api/settings/tags", {
        method: "PATCH",
        body: JSON.stringify({ oldName: "", newName: "" }),
      });
      const res = await tagsPatch(patchReq);
      expect(res.status).toBe(400);
    });
  });

  describe("Manual Investments Route Branches", () => {
    it("handles unauthorized calls", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const req = new NextRequest("http://localhost/api/investments/manual");
      expect((await manualInvPost(req)).status).toBe(401);
      expect((await manualInvDelete(req)).status).toBe(401);
    });

    it("handles invalid payload in POST", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: {} as never,
      });
      const req = new NextRequest("http://localhost/api/investments/manual", {
        method: "POST",
        body: JSON.stringify({ securityName: "" }),
      });
      expect((await manualInvPost(req)).status).toBe(400);
    });

    it("handles account not found in POST", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      } as never;

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: mockSupabase,
      });

      const req = new NextRequest("http://localhost/api/investments/manual", {
        method: "POST",
        body: JSON.stringify({
          accountSource: "plaid",
          accountId: "acc-1",
          securityName: "Apple",
          ticker: "AAPL",
          securityType: "equity",
          quantity: 10,
          price: 150,
          asOf: "2026-07-01",
          currency: "USD",
        }),
      });
      expect((await manualInvPost(req)).status).toBe(404);
    });

    it("handles delete manual holding not found or wrong source", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: "h-1", source: "plaid" }, error: null }),
            }),
          }),
        }),
      } as never;

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: mockSupabase,
      });

      const req = new NextRequest("http://localhost/api/investments/manual", {
        method: "DELETE",
        body: JSON.stringify({ id: "h-1" }),
      });
      expect((await manualInvDelete(req)).status).toBe(404);

      const invalidReq = new NextRequest("http://localhost/api/investments/manual", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      expect((await manualInvDelete(invalidReq)).status).toBe(400);
    });
  });

  describe("Demo API Route Branches", () => {
    it("handles unauthorized calls in demo route", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      expect((await demoPost()).status).toBe(401);
      expect((await demoDelete()).status).toBe(401);
    });

    it("refuses to load demo data if a real bank is connected", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: [{ plaid_item_id: "item-real-123" }],
          }),
        }),
      } as never;

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: mockSupabase,
      });

      const res = await demoPost();
      expect(res.status).toBe(409);
    });
  });

  describe("Calendar Route Branches", () => {
    it("returns 400 or 404 for invalid or non-existent calendar token", async () => {
      const req = new NextRequest("http://localhost/api/calendar/invalid-token");
      const res = await calendarGet(req, { params: Promise.resolve({ token: "" }) });
      expect([400, 404]).toContain(res.status);
    });
  });

  describe("Annotate Batch Route Branches", () => {
    it("handles unauthorized calls and invalid body format", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const req = new NextRequest("http://localhost/api/transactions/annotate-batch", {
        method: "POST",
        body: JSON.stringify({ operations: [] }),
      });
      expect((await annotateBatchPost(req)).status).toBe(401);
    });

    it("rejects empty operations array or missing payload", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: {} as never,
      });
      const reqEmpty = new NextRequest("http://localhost/api/transactions/annotate-batch", {
        method: "POST",
        body: JSON.stringify({ operations: [] }),
      });
      expect((await annotateBatchPost(reqEmpty)).status).toBe(400);

      const reqInvalid = new NextRequest("http://localhost/api/transactions/annotate-batch", {
        method: "POST",
        body: "invalid-json",
      });
      expect((await annotateBatchPost(reqInvalid)).status).toBe(400);
    });
  });

  describe("Manual Transactions Route Branches", () => {
    it("handles feature flag disabled", async () => {
      vi.spyOn(featureFlags, "isFeatureEnabled").mockReturnValue(false);
      const req = new NextRequest("http://localhost/api/transactions/manual");
      expect((await manualTxPost(req)).status).toBe(404);
      expect((await manualTxDelete(req)).status).toBe(404);
    });

    it("handles unauthorized calls", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const req = new NextRequest("http://localhost/api/transactions/manual");
      expect((await manualTxPost(req)).status).toBe(401);
      expect((await manualTxDelete(req)).status).toBe(401);
    });

    it("rejects invalid request payloads", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: {} as never,
      });
      const reqPost = new NextRequest("http://localhost/api/transactions/manual", {
        method: "POST",
        body: JSON.stringify({ date: "bad-date" }),
      });
      expect((await manualTxPost(reqPost)).status).toBe(400);

      const reqDelete = new NextRequest("http://localhost/api/transactions/manual", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      expect((await manualTxDelete(reqDelete)).status).toBe(400);
    });
  });

  describe("Saved Reports Route Branches", () => {
    it("handles rate limit, max report count 409, duplicate 409, and database errors", async () => {
      const validFilters = {
        version: 1,
        start: "2026-08-01",
        end: "2026-08-31",
        tab: "cash_flow",
        mode: "breakdown",
        dimension: "category",
        excludePending: true,
        accounts: [],
        merchants: [],
        categories: [],
      };

      const rateLimitModule = await import("@/lib/rate-limit");
      vi.spyOn(rateLimitModule, "checkRateLimit").mockResolvedValueOnce(false);

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: {} as never,
      });

      const reqRate = new NextRequest("http://localhost/api/reports/saved", {
        method: "POST",
        body: JSON.stringify({ name: "My Report", reportType: "cash_flow", filters: validFilters }),
      });
      expect((await savedReportPost(reqRate)).status).toBe(429);

      vi.spyOn(rateLimitModule, "checkRateLimit").mockResolvedValue(true);

      // Over max saved reports
      const maxCountDb = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 50, error: null }),
          }),
        }),
      };
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: maxCountDb as never,
      });

      const reqMax = new NextRequest("http://localhost/api/reports/saved", {
        method: "POST",
        body: JSON.stringify({ name: "My Report", reportType: "cash_flow", filters: validFilters }),
      });
      expect((await savedReportPost(reqMax)).status).toBe(409);

      // Duplicate report name
      const dupDb = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } }),
            }),
          }),
        }),
      };
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: dupDb as never,
      });

      const reqDup = new NextRequest("http://localhost/api/reports/saved", {
        method: "POST",
        body: JSON.stringify({ name: "My Report", reportType: "cash_flow", filters: validFilters }),
      });
      expect((await savedReportPost(reqDup)).status).toBe(409);

      // DELETE missing id or not found
      const notFoundDeleteDb = {
        from: vi.fn().mockReturnValue({
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      };
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: notFoundDeleteDb as never,
      });

      const reqNoId = new NextRequest("http://localhost/api/reports/saved", { method: "DELETE" });
      expect((await savedReportDelete(reqNoId)).status).toBe(400);

      const reqNotFound = new NextRequest("http://localhost/api/reports/saved?id=123", { method: "DELETE" });
      expect((await savedReportDelete(reqNotFound)).status).toBe(404);

      // Database error on count query, insert, and delete
      const errDb = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: null, error: new Error("Count query failed") }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error("Delete failed") }),
                }),
              }),
            }),
          }),
        }),
      };
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as never,
        supabase: errDb as never,
      });

      const reqErrPost = new NextRequest("http://localhost/api/reports/saved", {
        method: "POST",
        body: JSON.stringify({ name: "My Report", reportType: "cash_flow", filters: validFilters }),
      });
      expect((await savedReportPost(reqErrPost)).status).toBe(500);
      expect((await savedReportDelete(new NextRequest("http://localhost/api/reports/saved?id=123", { method: "DELETE" }))).status).toBe(500);
    });
  });
});
