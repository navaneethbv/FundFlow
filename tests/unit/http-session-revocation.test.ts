import { describe, it, expect, vi, beforeEach } from "vitest";

// Build a JWT-shaped access token carrying a session_id claim (payload only;
// requireUser decodes without verifying, since getUser already validated it).
function tokenWithSession(sessionId: string): string {
  const payload = Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url");
  return `header.${payload}.sig`;
}

const mockGetUser = vi.fn();
const mockGetAal = vi.fn();
const mockGetSession = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSelect = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockUpsert = vi.fn(() => ({ select: mockSelect }));
const mockFrom = vi.fn(() => ({ upsert: mockUpsert }));

const mockSupabaseClient = {
  auth: {
    getUser: mockGetUser,
    mfa: { getAuthenticatorAssuranceLevel: mockGetAal },
    getSession: mockGetSession,
  },
  from: mockFrom,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabaseClient,
}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => "test-agent" }),
}));

import { requireUser } from "@/lib/http";

describe("requireUser session revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "a@b.com" } } });
    mockGetAal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" } });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: tokenWithSession("sess-1") } } });
  });

  it("401s when the session record is revoked", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { revoked_at: "2026-07-01T00:00:00Z" } });
    const result = await requireUser();
    expect(result).toBeInstanceOf(Response);
    const resp = result as Response;
    expect(resp.status).toBe(401);
    expect((await resp.json()).error).toBe("Session revoked");
  });

  it("records the session and passes when not revoked", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { revoked_at: null } });
    const result = await requireUser();
    expect(result).not.toBeInstanceOf(Response);
    expect(mockFrom).toHaveBeenCalledWith("user_session_records");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", session_id: "sess-1" }),
      { onConflict: "user_id,session_id" },
    );
  });

  it("falls open (still authorizes) if session recording throws", async () => {
    mockMaybeSingle.mockRejectedValue(new Error("db down"));
    const result = await requireUser();
    expect(result).not.toBeInstanceOf(Response);
  });
});
