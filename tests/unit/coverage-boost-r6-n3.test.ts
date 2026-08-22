import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "@/tests/fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) => NextResponse.json({ error: String(error) }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
const mockCurrentSessionId = vi.fn<(...args: unknown[]) => unknown>(() => "session-active");
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
  currentSessionId: (...args: unknown[]) => mockCurrentSessionId(...args),
}));

const mockBuildSessionList = vi.fn<(...args: unknown[]) => unknown>((sessions: unknown) => sessions);
vi.mock("@/lib/security-account", () => ({
  buildSessionList: (sessions: unknown) => mockBuildSessionList(sessions),
}));

const mockServiceClient = { from: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

import { GET as sessionsGet, DELETE as sessionsDelete } from "@/app/api/settings/sessions/route";

function jsonRequest(body: unknown) {
  return { url: "https://x.local", json: async () => body } as unknown as NextRequest;
}

function rejectingJsonRequest() {
  return { url: "https://x.local", json: () => Promise.reject(new Error("json fail")) } as unknown as NextRequest;
}

describe("coverage boost r6 n3: settings/sessions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentSessionId.mockResolvedValue("session-active");
  });

  describe("GET /api/settings/sessions", () => {
    it("returns 401 when not authenticated (L8 true, B@8)", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await sessionsGet();
      expect(res.status).toBe(401);
    });

    it("builds the session list from fetched rows (L22 false, L24-31 map, B@26)", async () => {
      const supabase = clientStub({
        user_session_records: {
          data: [
            { id: "s1", session_id: "session-active", user_agent: "Chrome", revoked_at: null, last_seen_at: "2026-07-13" },
            { id: "s2", session_id: "other", user_agent: null, revoked_at: null, last_seen_at: "2026-07-12" },
          ],
          error: null,
        },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await sessionsGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        sessions: [
          { id: "s1", current: true, userAgent: "Chrome", lastSeenAt: "2026-07-13" },
          { id: "s2", current: false, userAgent: null, lastSeenAt: "2026-07-12" },
        ],
      });
      expect(mockBuildSessionList).toHaveBeenCalledTimes(1);
      expect(mockCurrentSessionId).toHaveBeenCalledWith(supabase);
    });

    it("handles a null data payload via ?? (L26 nullish side)", async () => {
      const supabase = clientStub({ user_session_records: { data: null, error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await sessionsGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ sessions: [] });
    });

    it("returns 500 when the fetch errors (L22 true, L35)", async () => {
      const supabase = clientStub({ user_session_records: { data: null, error: new Error("db boom") } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await sessionsGet();
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.sessions", expect.any(Error));
    });
  });

  describe("DELETE /api/settings/sessions", () => {
    it("returns 401 when not authenticated (L41 true, B@41)", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await sessionsDelete(jsonRequest({ session_id: "s1" }));
      expect(res.status).toBe(401);
    });

    it("rejects when json() rejects (L45 catch arrow, L47 true, B@47)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const res = await sessionsDelete(rejectingJsonRequest());
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("session_id is required");
    });

    it("rejects a non-string session_id", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const res = await sessionsDelete(jsonRequest({ session_id: 5 }));
      expect(res.status).toBe(400);
    });

    it("revokes a session via the service client (L47 false, L55 false, L57)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const updateMock = vi.fn().mockResolvedValue({ error: null });
      mockServiceClient.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ eq: updateMock }),
        }),
      });
      const res = await sessionsDelete(jsonRequest({ session_id: "s1" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect(mockServiceClient.from).toHaveBeenCalledWith("user_session_records");
      expect(updateMock).toHaveBeenCalled();
    });

    it("returns 500 when the revoke fails (L55 true, L59)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      mockServiceClient.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: new Error("revoke boom") }) }),
        }),
      });
      const res = await sessionsDelete(jsonRequest({ session_id: "s1" }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.sessions.delete", expect.any(Error));
    });
  });
});