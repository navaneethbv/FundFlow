import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn();
const mockErrorResponse = vi.fn();
const mockBadRequest = vi.fn((msg) => new Response(msg, { status: 400 }));
const mockCurrentSessionId = vi.fn(() => "session-active");
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (msg: string) => mockBadRequest(msg),
  currentSessionId: (...args: unknown[]) => mockCurrentSessionId(...args),
}));

const mockBuildAuditLogPage = vi.fn((logs) => ({ logs }));
const mockBuildSessionList = vi.fn((sessions) => ({ sessions }));
vi.mock("@/lib/security-account", () => ({
  buildAuditLogPage: (logs: unknown) => mockBuildAuditLogPage(logs),
  buildSessionList: (sessions: unknown) => mockBuildSessionList(sessions),
}));

const mockServiceClient = {
  from: vi.fn(),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

import { GET as auditGet } from "@/app/api/settings/audit/route";
import {
  GET as sessionsGet,
  DELETE as sessionsDelete,
} from "@/app/api/settings/sessions/route";
import { NextResponse, NextRequest } from "next/server";

describe("Settings API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/settings/audit", () => {
    it("returns audit logs successfully with default limit", async () => {
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                { user_id: "u1", action: "login", metadata: { ip: "1" } },
              ],
              error: null,
            }),
          }),
        }),
      });
      const mockSupabase = {
        from: vi.fn().mockReturnValue({ select: selectMock }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });

      const request = new Request(
        "http://localhost/api/settings/audit",
      ) as NextRequest;
      (request as any).nextUrl = { searchParams: new URLSearchParams() };

      const res = await auditGet(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("logs");
      expect(mockBuildAuditLogPage).toHaveBeenCalled();
    });

    it("handles db fetch error", async () => {
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: null,
              error: new Error("DB Error"),
            }),
          }),
        }),
      });
      const mockSupabase = {
        from: vi.fn().mockReturnValue({ select: selectMock }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });

      const request = new Request(
        "http://localhost/api/settings/audit",
      ) as NextRequest;
      (request as any).nextUrl = { searchParams: new URLSearchParams() };
      mockErrorResponse.mockReturnValue(new Response("error", { status: 500 }));

      const res = await auditGet(request);
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith(
        "settings.audit",
        expect.any(Error),
      );
    });
  });

  describe("GET /api/settings/sessions", () => {
    it("returns active sessions list", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: "s1",
                      session_id: "session-active",
                      user_agent: "Chrome",
                      last_seen_at: "2026-07-13",
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });

      const res = await sessionsGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("sessions");
      expect(mockBuildSessionList).toHaveBeenCalled();
    });
  });

  describe("DELETE /api/settings/sessions", () => {
    it("revokes specified session successfully", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const request = {
        json: () => Promise.resolve({ session_id: "s1" }),
      } as unknown as NextRequest;

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      });
      mockServiceClient.from.mockReturnValue({ update: updateMock });

      const res = await sessionsDelete(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it("returns bad request if session_id is missing", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const request = {
        json: () => Promise.resolve({}),
      } as unknown as NextRequest;

      const res = await sessionsDelete(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("session_id is required");
    });
  });
});
