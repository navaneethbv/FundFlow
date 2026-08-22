import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) =>
    NextResponse.json({ error: String(error) }, { status: 500 }),
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

const mockSendHouseholdInviteEmail = vi.fn<(...args: unknown[]) => unknown>(
  () => Promise.resolve(undefined),
);
vi.mock("@/lib/reporting", () => ({
  sendHouseholdInviteEmail: (...args: unknown[]) =>
    mockSendHouseholdInviteEmail(...args),
}));

const envState = vi.hoisted(() => ({ appUrl: null as string | null }));
vi.mock("@/lib/env.server", () => ({ serverEnv: envState }));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

import { POST } from "@/app/api/household/invite/route";

function postReq(body: unknown): NextRequest {
  return new NextRequest("https://x.local/api/household/invite", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const LONG_EMAIL = `a${"x".repeat(400)}@b.com`;

describe("POST /api/household/invite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
    envState.appUrl = null;
  });

  it("passes through the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await POST(postReq({ householdId: "h1", email: "a@b.com" }));
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    mockCheckRateLimit.mockResolvedValue(false);
    const res = await POST(postReq({ householdId: "h1", email: "a@b.com" }));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: "Too many invites today." });
  });

  it("falls back to null body when json() rejects", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(
      new NextRequest("https://x.local/api/household/invite", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a missing householdId, missing email, malformed email, or overlong email", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    for (const body of [
      { email: "a@b.com" },
      { householdId: "h1" },
      { householdId: "h1", email: "not-an-email" },
      { householdId: "h1", email: LONG_EMAIL },
      { householdId: "h1", email: "   " },
    ]) {
      const res = await POST(postReq(body));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "householdId and a valid email are required",
      );
    }
  });

  it("returns 404 when the household is missing or not owned by the caller", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ households: { data: null, error: null } }),
    });
    const resMissing = await POST(postReq({ householdId: "h1", email: "a@b.com" }));
    expect(resMissing.status).toBe(404);
    await expect(resMissing.json()).resolves.toEqual({ error: "Household not found" });

    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        households: { data: { id: "h1", name: "Family", owner_user_id: "other" }, error: null },
      }),
    });
    const resNotOwner = await POST(postReq({ householdId: "h1", email: "a@b.com" }));
    expect(resNotOwner.status).toBe(404);
  });

  it("sends an invite, trims the email, and falls back to the localhost accept URL", async () => {
    const client = clientStub({
      households: { data: { id: "h1", name: "Family", owner_user_id: "u1" }, error: null },
      household_invites: { data: null, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1", email: null }, supabase: client });

    const res = await POST(
      postReq({ householdId: "h1", email: "  PARTNER@Example.com  " }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    expect(client.writtenTo("household_invites")).toMatchObject({
      household_id: "h1",
      email: "partner@example.com",
      invited_by: "u1",
      token_hash: expect.any(String),
    });
    expect(mockSendHouseholdInviteEmail).toHaveBeenCalledWith(
      "partner@example.com",
      "A FundFlow user",
      "Family",
      expect.stringMatching(
        /^http:\/\/localhost:3000\/api\/household\/accept\?token=/,
      ),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "household_invite_sent",
        metadata: expect.objectContaining({ household_id: "h1" }),
      }),
    );
  });

  it("uses the configured app URL and the caller's email when present", async () => {
    envState.appUrl = "https://app.example.com";
    const client = clientStub({
      households: { data: { id: "h1", name: "Family", owner_user_id: "u1" }, error: null },
      household_invites: { data: null, error: null },
    });
    mockRequireUser.mockResolvedValue({
      user: { id: "u1", email: "owner@example.com" },
      supabase: client,
    });

    const res = await POST(postReq({ householdId: "h1", email: "a@b.com" }));
    expect(res.status).toBe(200);
    expect(mockSendHouseholdInviteEmail).toHaveBeenCalledWith(
      "a@b.com",
      "owner@example.com",
      "Family",
      expect.stringMatching(/^https:\/\/app\.example\.com\/api\/household\/accept\?token=/),
    );
  });

  it("throws through errorResponse when the invite insert fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        households: { data: { id: "h1", name: "Family", owner_user_id: "u1" }, error: null },
        household_invites: { data: null, error: { message: "insert failed" } },
      }),
    });
    const res = await POST(postReq({ householdId: "h1", email: "a@b.com" }));
    expect(res.status).toBe(500);
  });
});