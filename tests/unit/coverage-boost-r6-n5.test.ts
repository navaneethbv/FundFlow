import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) => NextResponse.json({ error: String(error) }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

import { POST as cancelledPost, DELETE as cancelledDelete } from "@/app/api/subscriptions/cancelled/route";
import { clientStub } from "@/tests/fixtures/supabase-query";

function jsonRequest(body: unknown) {
  return { url: "https://x.local", json: async () => body } as unknown as NextRequest;
}

function rejectingJsonRequest() {
  return { url: "https://x.local", json: () => Promise.reject(new Error("json fail")) } as unknown as NextRequest;
}

describe("coverage boost r6 n5: subscriptions/cancelled route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/subscriptions/cancelled", () => {
    it("returns 401 when not authenticated (L11 true, B@11)", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await cancelledPost(jsonRequest({ merchant: "Netflix" }));
      expect(res.status).toBe(401);
    });

    it("rejects when json() rejects (L15 catch arrow, L17 true, B@17)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await cancelledPost(rejectingJsonRequest());
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("merchant is required");
    });

    it("rejects a blank merchant", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await cancelledPost(jsonRequest({ merchant: "   " }));
      expect(res.status).toBe(400);
    });

    it("rejects a merchant longer than 160 chars (L17 length side)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await cancelledPost(jsonRequest({ merchant: "x".repeat(161) }));
      expect(res.status).toBe(400);
    });

    it("inserts the merchant (L22 false, L24)", async () => {
      const supabase = clientStub({ cancelled_subscriptions: { data: null, error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await cancelledPost(jsonRequest({ merchant: "  Netflix  " }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect(supabase.writtenTo("cancelled_subscriptions")).toEqual({ user_id: "u1", merchant: "Netflix" });
    });

    it("tolerates a duplicate insert error (L22 true, includes side)", async () => {
      const supabase = clientStub({
        cancelled_subscriptions: { data: null, error: { message: "duplicate key value violates unique constraint" } },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await cancelledPost(jsonRequest({ merchant: "Netflix" }));
      expect(res.status).toBe(200);
    });

    it("throws on a non-duplicate insert error (L22 true, throw side, L26)", async () => {
      const supabase = clientStub({ cancelled_subscriptions: { data: null, error: { message: "other boom" } } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await cancelledPost(jsonRequest({ merchant: "Netflix" }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("subscriptions.cancelled.add", expect.any(Object));
    });
  });

  describe("DELETE /api/subscriptions/cancelled", () => {
    it("returns 401 when not authenticated (L32 true, B@32)", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await cancelledDelete(jsonRequest({ merchant: "Netflix" }));
      expect(res.status).toBe(401);
    });

    it("rejects when json() rejects (L36 catch arrow, L38 true, B@38)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await cancelledDelete(rejectingJsonRequest());
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("merchant is required");
    });

    it("rejects a blank merchant", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await cancelledDelete(jsonRequest({ merchant: "" }));
      expect(res.status).toBe(400);
    });

    it("deletes the merchant row (L38 false, L45 false, L47)", async () => {
      const supabase = clientStub({ cancelled_subscriptions: { data: null, error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await cancelledDelete(jsonRequest({ merchant: "Netflix" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect(supabase.callsOn("cancelled_subscriptions")).toContainEqual({ method: "eq", args: ["merchant", "Netflix"] });
    });

    it("returns 500 when the delete fails (L45 true, L49)", async () => {
      const supabase = clientStub({ cancelled_subscriptions: { data: null, error: new Error("delete boom") } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await cancelledDelete(jsonRequest({ merchant: "Netflix" }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("subscriptions.cancelled.remove", expect.any(Error));
    });
  });
});