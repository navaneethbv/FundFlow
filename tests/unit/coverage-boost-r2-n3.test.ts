import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) =>
    NextResponse.json({ error: String(error) }, { status: 500 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
}));

const mockServiceClient = { from: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

import { GET } from "@/app/api/household/accept/route";

const TOKEN = "a".repeat(32);

function acceptReq(token?: string): NextRequest {
  const search = new URLSearchParams();
  if (token !== undefined) search.set("token", token);
  return new NextRequest(`https://x.local/api/household/accept?${search.toString()}`);
}

describe("GET /api/household/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await GET(acceptReq(TOKEN));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://x.local/login");
  });

  it("redirects to invalid when the token is missing or too short", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1", email: "a@b.com" } });
    const resMissing = await GET(acceptReq(undefined));
    expect(resMissing.status).toBe(307);
    expect(resMissing.headers.get("location")).toBe(
      "https://x.local/settings?invite=invalid",
    );

    const resShort = await GET(acceptReq("short"));
    expect(resShort.status).toBe(307);
  });

  it("redirects to invalid when no invite matches the token hash", async () => {
    mockServiceClient.from.mockReturnValue(
      clientStub({ household_invites: { data: null, error: null } }).from("household_invites"),
    );
    mockRequireUser.mockResolvedValue({ user: { id: "u1", email: "a@b.com" } });
    const res = await GET(acceptReq(TOKEN));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://x.local/settings?invite=invalid",
    );
  });

  it("redirects to invalid when the invite is already accepted", async () => {
    mockServiceClient.from.mockReturnValue(
      clientStub({
        household_invites: {
          data: {
            id: "inv-1",
            household_id: "hh-1",
            email: "a@b.com",
            expires_at: "2999-01-01T00:00:00Z",
            accepted_at: "2026-01-01T00:00:00Z",
          },
          error: null,
        },
      }).from("household_invites"),
    );
    mockRequireUser.mockResolvedValue({ user: { id: "u1", email: "a@b.com" } });
    const res = await GET(acceptReq(TOKEN));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://x.local/settings?invite=invalid",
    );
  });

  it("redirects to invalid when the invite has expired", async () => {
    mockServiceClient.from.mockReturnValue(
      clientStub({
        household_invites: {
          data: {
            id: "inv-1",
            household_id: "hh-1",
            email: "a@b.com",
            expires_at: "2020-01-01T00:00:00Z",
            accepted_at: null,
          },
          error: null,
        },
      }).from("household_invites"),
    );
    mockRequireUser.mockResolvedValue({ user: { id: "u1", email: "a@b.com" } });
    const res = await GET(acceptReq(TOKEN));
    expect(res.status).toBe(307);
  });

  it("redirects to invalid when the signup email does not match the invite", async () => {
    mockServiceClient.from.mockReturnValue(
      clientStub({
        household_invites: {
          data: {
            id: "inv-1",
            household_id: "hh-1",
            email: "OTHER@example.com",
            expires_at: "2999-01-01T00:00:00Z",
            accepted_at: null,
          },
          error: null,
        },
      }).from("household_invites"),
    );
    mockRequireUser.mockResolvedValue({ user: { id: "u1", email: "a@b.com" } });
    const res = await GET(acceptReq(TOKEN));
    expect(res.status).toBe(307);
  });

  it("redirects to invalid when the user has no email at all", async () => {
    mockServiceClient.from.mockReturnValue(
      clientStub({
        household_invites: {
          data: {
            id: "inv-1",
            household_id: "hh-1",
            email: "a@b.com",
            expires_at: "2999-01-01T00:00:00Z",
            accepted_at: null,
          },
          error: null,
        },
      }).from("household_invites"),
    );
    mockRequireUser.mockResolvedValue({ user: { id: "u1", email: null } });
    const res = await GET(acceptReq(TOKEN));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://x.local/settings?invite=invalid",
    );
  });

  it("accepts the invite and redirects to accepted", async () => {
    const client = clientStub({
      household_invites: {
        data: {
          id: "inv-1",
          household_id: "hh-1",
          email: "A@B.COM",
          expires_at: "2999-01-01T00:00:00Z",
          accepted_at: null,
        },
        error: null,
      },
      household_members: { data: null, error: null },
    });
    mockServiceClient.from.mockImplementation((table: string) =>
      client.from(table),
    );
    mockRequireUser.mockResolvedValue({
      user: { id: "u1", email: "a@b.com" },
    });
    const res = await GET(acceptReq(TOKEN));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://x.local/settings?invite=accepted",
    );
    expect(client.writtenTo("household_members")).toEqual({
      household_id: "hh-1",
      user_id: "u1",
      role: "member",
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "household_invite_accepted",
        metadata: expect.objectContaining({ household_id: "hh-1" }),
      }),
    );
  });

  it("treats a duplicate membership error as success", async () => {
    const client = clientStub({
      household_invites: {
        data: {
          id: "inv-1",
          household_id: "hh-1",
          email: "a@b.com",
          expires_at: "2999-01-01T00:00:00Z",
          accepted_at: null,
        },
        error: null,
      },
      household_members: {
        data: null,
        error: { message: "duplicate key value violates unique constraint" },
      },
    });
    mockServiceClient.from.mockImplementation((table: string) =>
      client.from(table),
    );
    mockRequireUser.mockResolvedValue({ user: { id: "u1", email: "a@b.com" } });
    const res = await GET(acceptReq(TOKEN));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://x.local/settings?invite=accepted",
    );
  });

  it("throws through errorResponse on an unrelated membership error", async () => {
    const client = clientStub({
      household_invites: {
        data: {
          id: "inv-1",
          household_id: "hh-1",
          email: "a@b.com",
          expires_at: "2999-01-01T00:00:00Z",
          accepted_at: null,
        },
        error: null,
      },
      household_members: { data: null, error: { message: "db down" } },
    });
    mockServiceClient.from.mockImplementation((table: string) =>
      client.from(table),
    );
    mockRequireUser.mockResolvedValue({ user: { id: "u1", email: "a@b.com" } });
    const res = await GET(acceptReq(TOKEN));
    expect(res.status).toBe(500);
  });
});