import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn();
const mockCurrentSessionId = vi.fn();
const mockErrorResponse = vi.fn();
const mockBadRequest = vi.fn();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  currentSessionId: (...args: unknown[]) => mockCurrentSessionId(...args),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (msg: string) => {
    mockBadRequest(msg);
    return new Response(JSON.stringify({ error: msg }), { status: 400 });
  },
}));

const mockServiceClient = {
  from: vi.fn(),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

import { GET, DELETE } from "@/app/api/settings/sessions/route";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("GET / DELETE /api/settings/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("returns early if user is unauthenticated", async () => {
      const errorRes = new NextResponse("unauthorized", { status: 401 });
      mockRequireUser.mockResolvedValue(errorRes);

      const res = await GET();
      expect(res).toBe(errorRes);
    });

    it("returns formatted active session list", async () => {
      const limit = vi.fn().mockResolvedValue({
        data: [
          {
            id: "s-1",
            session_id: "sess-1",
            user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            revoked_at: null,
            last_seen_at: "2026-07-29T00:00:00.000Z",
          },
        ],
        error: null,
      });
      const order = vi.fn().mockReturnValue({ limit });
      const isNull = vi.fn().mockReturnValue({ order });
      const eq = vi.fn().mockReturnValue({ is: isNull });
      const select = vi.fn().mockReturnValue({ eq });
      const mockSupabase = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient;

      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: mockSupabase });
      mockCurrentSessionId.mockResolvedValue("sess-1");

      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessions).toBeDefined();
      expect(body.sessions[0]).toEqual(
        expect.objectContaining({
          id: "s-1",
          current: true,
          label: expect.stringContaining("Mac"),
        }),
      );
    });

    it("calls errorResponse on GET database error", async () => {
      const limit = vi.fn().mockResolvedValue({ data: null, error: new Error("DB Error") });
      const order = vi.fn().mockReturnValue({ limit });
      const isNull = vi.fn().mockReturnValue({ order });
      const eq = vi.fn().mockReturnValue({ is: isNull });
      const select = vi.fn().mockReturnValue({ eq });
      const mockSupabase = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient;

      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: mockSupabase });
      mockCurrentSessionId.mockResolvedValue("sess-1");
      mockErrorResponse.mockReturnValue(new Response("error", { status: 500 }));

      const res = await GET();
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.sessions", expect.any(Error));
    });
  });

  describe("DELETE", () => {
    it("returns badRequest if session_id is missing or invalid", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });

      const req = new NextRequest("http://localhost/api/settings/sessions", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("session_id is required");
    });

    it("revokes session via service client", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });

      const eqSessionId = vi.fn().mockResolvedValue({ error: null });
      const eqUserId = vi.fn().mockReturnValue({ eq: eqSessionId });
      const update = vi.fn().mockReturnValue({ eq: eqUserId });
      mockServiceClient.from.mockReturnValue({ update });

      const req = new NextRequest("http://localhost/api/settings/sessions", {
        method: "DELETE",
        body: JSON.stringify({ session_id: "s-1" }),
      });

      const res = await DELETE(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ revoked_at: expect.any(String) }),
      );
      expect(eqUserId).toHaveBeenCalledWith("user_id", "user-1");
      expect(eqSessionId).toHaveBeenCalledWith("id", "s-1");
    });

    it("calls errorResponse on DELETE failure", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });

      const eqSessionId = vi.fn().mockResolvedValue({ error: new Error("DB Error") });
      const eqUserId = vi.fn().mockReturnValue({ eq: eqSessionId });
      const update = vi.fn().mockReturnValue({ eq: eqUserId });
      mockServiceClient.from.mockReturnValue({ update });

      mockErrorResponse.mockReturnValue(new Response("error", { status: 500 }));

      const req = new NextRequest("http://localhost/api/settings/sessions", {
        method: "DELETE",
        body: JSON.stringify({ session_id: "s-1" }),
      });

      const res = await DELETE(req);
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.sessions.delete", expect.any(Error));
    });
  });
});
