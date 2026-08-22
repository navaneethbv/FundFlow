import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_ctx: unknown, error: unknown) =>
    NextResponse.json({ error: (error as Error).message }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(
  () => Promise.resolve(true),
);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockBuildBillsCalendar = vi.fn<(...args: unknown[]) => unknown>(
  () => "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
);
vi.mock("@/lib/ical", () => ({
  buildBillsCalendar: (...args: unknown[]) => mockBuildBillsCalendar(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

const mockCalendarTokenCreated = vi.fn<(...args: unknown[]) => unknown>();
const mockCalendarTokenRevoked = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/request-audit", () => ({
  requestAudits: {
    calendarTokenCreated: (...args: unknown[]) => mockCalendarTokenCreated(...args),
    calendarTokenRevoked: (...args: unknown[]) => mockCalendarTokenRevoked(...args),
  },
}));

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

import { GET as calendarFeedGet } from "@/app/api/calendar/[token]/route";
import { POST as tokenPost, DELETE as tokenDelete } from "@/app/api/calendar/token/route";

describe("coverage-boost-plaid-n2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceClient = clientStub();
    mockCheckRateLimit.mockResolvedValue(true);
  });

  describe("GET /api/calendar/[token]", () => {
    const feed = (token: string) =>
      calendarFeedGet({} as Request, {
        params: Promise.resolve({ token }),
      });

    it("returns 404 for a token shorter than 20 chars", async () => {
      const res = await feed("short");
      expect(res.status).toBe(404);
    });

    it("returns 429 when rate limited", async () => {
      mockCheckRateLimit.mockResolvedValue(false);
      const res = await feed("a".repeat(24));
      expect(res.status).toBe(429);
    });

    it("returns 404 when the token row is missing", async () => {
      serviceClient = clientStub({
        calendar_tokens: { data: null },
      });
      const res = await feed("a".repeat(24));
      expect(res.status).toBe(404);
    });

    it("builds the calendar with all frequency branches and streams present", async () => {
      serviceClient = clientStub({
        calendar_tokens: { data: { user_id: "u1", include_amounts: true } },
        recurring_streams: {
          data: [
            { id: "s1", merchant_name: "Rent", description: "Rent", last_amount: 100, average_amount: 90, frequency: "weekly", stream_type: "expense", is_active: true },
            { id: "s2", merchant_name: "Pay", description: "Pay", last_amount: 500, average_amount: 500, frequency: "biweekly", stream_type: "inflow", is_active: true },
            { id: "s3", merchant_name: "Tax", description: "Tax", last_amount: 20, average_amount: 20, frequency: "quarterly", stream_type: "expense", is_active: true },
            { id: "s4", merchant_name: "Sub", description: "Sub", last_amount: 10, average_amount: 10, frequency: "yearly", stream_type: "expense", is_active: true },
            { id: "s5", merchant_name: "Other", description: "Other", last_amount: 5, average_amount: 5, frequency: "monthly", stream_type: "expense", is_active: true },
            { id: "s6", merchant_name: "Null", description: "Null", last_amount: 6, average_amount: 6, frequency: null, stream_type: "expense", is_active: true },
          ],
        },
      });
      const res = await feed("a".repeat(24));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/calendar");
      expect(mockBuildBillsCalendar).toHaveBeenCalledTimes(1);
      const arg = mockBuildBillsCalendar.mock.calls[0]![0] as { bills: Array<{ frequency: string }> };
      expect(arg.bills.map((b) => b.frequency)).toEqual([
        "weekly", "biweekly", "quarterly", "yearly", "monthly", "monthly",
      ]);
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "calendar_feed_read" }),
      );
    });

    it("handles a null streams result", async () => {
      serviceClient = clientStub({
        calendar_tokens: { data: { user_id: "u1", include_amounts: false } },
        recurring_streams: { data: null },
      });
      const res = await feed("a".repeat(24));
      expect(res.status).toBe(200);
    });

    it("returns errorResponse when rate limit throws", async () => {
      mockCheckRateLimit.mockRejectedValue(new Error("boom"));
      const res = await feed("a".repeat(24));
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/calendar/token", () => {
    const authedSupabase = (chain: unknown) => ({
      from: vi.fn().mockReturnValue(chain),
    });

    it("mints a token successfully", async () => {
      const supabase = authedSupabase({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: "t1" }, error: null }),
      });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const req = new NextRequest("http://localhost/api/calendar/token", {
        method: "POST",
        body: JSON.stringify({ includeAmounts: true }),
      });
      const res = await tokenPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.token).toBeTruthy();
      expect(json.row).toEqual({ id: "t1" });
      expect(mockCalendarTokenCreated).toHaveBeenCalledTimes(1);
    });

    it("returns errorResponse when insert fails", async () => {
      const supabase = authedSupabase({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: "db" } }),
      });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const req = new NextRequest("http://localhost/api/calendar/token", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await tokenPost(req);
      expect(res.status).toBe(500);
    });

    it("returns auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await tokenPost({} as NextRequest);
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /api/calendar/token", () => {
    it("returns bad request when id is missing", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: { from: vi.fn() },
      });
      const req = new NextRequest("http://localhost/api/calendar/token", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      const res = await tokenDelete(req);
      expect(res.status).toBe(400);
    });

    it("mints a token when the body is invalid JSON", async () => {
      const supabase = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: "t1" }, error: null }),
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const req = new NextRequest("http://localhost/api/calendar/token", {
        method: "POST",
        body: "not json",
      });
      const res = await tokenPost(req);
      expect(res.status).toBe(200);
    });

    it("revokes a token successfully", async () => {
      const supabase = {
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const req = new NextRequest("http://localhost/api/calendar/token", {
        method: "DELETE",
        body: JSON.stringify({ id: "t1" }),
      });
      const res = await tokenDelete(req);
      expect(res.status).toBe(200);
      expect(mockCalendarTokenRevoked).toHaveBeenCalledTimes(1);
    });

    it("returns errorResponse when update fails", async () => {
      const supabase = {
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        }),
      };
      (supabase.from().update() as { eq: ReturnType<typeof vi.fn> }).eq.mockReturnValue(
        Promise.resolve({ error: { message: "db" } }),
      );
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const req = new NextRequest("http://localhost/api/calendar/token", {
        method: "DELETE",
        body: JSON.stringify({ id: "t1" }),
      });
      const res = await tokenDelete(req);
      expect(res.status).toBe(500);
    });

    it("returns auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await tokenDelete({} as NextRequest);
      expect(res.status).toBe(401);
    });
  });
});
