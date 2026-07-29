import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn();
const mockErrorResponse = vi.fn();
const mockBadRequest = vi.fn();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (msg: string) => {
    mockBadRequest(msg);
    return new Response(JSON.stringify({ error: msg }), { status: 400 });
  },
}));

import { POST, DELETE } from "@/app/api/push/subscribe/route";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("POST / DELETE /api/push/subscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST", () => {
    it("returns early if user is unauthenticated", async () => {
      const errorRes = new NextResponse("unauthorized", { status: 401 });
      mockRequireUser.mockResolvedValue(errorRes);

      const req = new NextRequest("http://localhost/api/push/subscribe", { method: "POST" });
      const res = await POST(req);
      expect(res).toBe(errorRes);
    });

    it("returns badRequest if body keys are missing or invalid", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: {} });

      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: "https://push.com" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("A push subscription (endpoint + keys) is required");
    });

    it("upserts subscription into push_subscriptions", async () => {
      const upsert = vi.fn().mockResolvedValue({ error: null });
      const mockSupabase = { from: vi.fn().mockReturnValue({ upsert }) } as unknown as SupabaseClient;

      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: mockSupabase });

      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://push.com/sub-1",
          keys: { p256dh: "key-p256dh", auth: "key-auth" },
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect(upsert).toHaveBeenCalledWith(
        {
          user_id: "user-1",
          endpoint: "https://push.com/sub-1",
          p256dh: "key-p256dh",
          auth: "key-auth",
        },
        { onConflict: "endpoint" },
      );
    });

    it("calls errorResponse on upsert error", async () => {
      const upsert = vi.fn().mockResolvedValue({ error: new Error("DB Error") });
      const mockSupabase = { from: vi.fn().mockReturnValue({ upsert }) } as unknown as SupabaseClient;

      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: mockSupabase });
      mockErrorResponse.mockReturnValue(new Response("error", { status: 500 }));

      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://push.com/sub-1",
          keys: { p256dh: "key-p256dh", auth: "key-auth" },
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("push.subscribe", expect.any(Error));
    });
  });

  describe("DELETE", () => {
    it("returns badRequest if endpoint is missing", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: {} });

      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("endpoint is required");
    });

    it("deletes subscription from push_subscriptions", async () => {
      const eq = vi.fn().mockResolvedValue({ error: null });
      const del = vi.fn().mockReturnValue({ eq });
      const mockSupabase = { from: vi.fn().mockReturnValue({ delete: del }) } as unknown as SupabaseClient;

      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: mockSupabase });

      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: "https://push.com/sub-1" }),
      });

      const res = await DELETE(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect(eq).toHaveBeenCalledWith("endpoint", "https://push.com/sub-1");
    });

    it("calls errorResponse on delete failure", async () => {
      const eq = vi.fn().mockResolvedValue({ error: new Error("DB Error") });
      const del = vi.fn().mockReturnValue({ eq });
      const mockSupabase = { from: vi.fn().mockReturnValue({ delete: del }) } as unknown as SupabaseClient;

      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: mockSupabase });
      mockErrorResponse.mockReturnValue(new Response("error", { status: 500 }));

      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: "https://push.com/sub-1" }),
      });

      const res = await DELETE(req);
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("push.unsubscribe", expect.any(Error));
    });
  });
});
