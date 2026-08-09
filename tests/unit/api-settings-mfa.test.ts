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

const mockWriteAudit = vi.fn();
const mockGetClientIp = vi.fn().mockReturnValue("127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

import { POST } from "@/app/api/settings/mfa/route";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("POST /api/settings/mfa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early if user is unauthenticated", async () => {
    const errorRes = new NextResponse("unauthorized", { status: 401 });
    mockRequireUser.mockResolvedValue(errorRes);

    const req = new NextRequest("http://localhost/api/settings/mfa", { method: "POST" });
    const res = await POST(req);
    expect(res).toBe(errorRes);
  });

  it("returns badRequest if body is missing or invalid", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: {} });

    const req = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: "",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Missing request body");
  });

  it("returns badRequest if action is invalid", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: {} });

    const req = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({ action: "invalid_action", factorId: "f-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith(
      "Invalid action: must be 'enroll', 'verify', or 'unenroll'",
    );
  });

  it("returns badRequest if factorId is invalid or missing", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: {} });

    const req = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({ action: "enroll", factorId: 123 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid factorId: must be a string");
  });

  it("handles enrollment success when factor is verified", async () => {
    const listFactors = vi.fn().mockResolvedValue({
      data: {
        totp: [{ id: "f-1", status: "verified" }],
      },
      error: null,
    });
    const updateProfile = vi.fn().mockResolvedValue({ error: null });
    const eqProfile = vi.fn().mockReturnValue(updateProfile);
    const from = vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq: eqProfile }) });

    const mockSupabase = {
      auth: { mfa: { listFactors } },
      from,
    } as unknown as SupabaseClient;

    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: mockSupabase });

    const req = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({ action: "enroll", factorId: "f-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, mfa_enrolled: true });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mfa_enroll",
        metadata: { factorId: "f-1" },
      }),
    );
  });

  it("returns badRequest on verify if factor is not verified", async () => {
    const listFactors = vi.fn().mockResolvedValue({
      data: {
        totp: [{ id: "f-1", status: "unverified" }],
      },
      error: null,
    });
    const mockSupabase = {
      auth: { mfa: { listFactors } },
    } as unknown as SupabaseClient;

    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: mockSupabase });

    const req = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({ action: "verify", factorId: "f-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith(
      "MFA factor must be verified before finalizing enrollment",
    );
  });

  it("derives the profile flag and audit event after verification", async () => {
    const listFactors = vi.fn().mockResolvedValue({
      data: { totp: [{ id: "f-1", status: "verified" }] },
      error: null,
    });
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const mockSupabase = {
      auth: { mfa: { listFactors } },
      from: vi.fn().mockReturnValue({ update }),
    } as unknown as SupabaseClient;
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: mockSupabase });

    const response = await POST(
      new NextRequest("http://localhost/api/settings/mfa", {
        method: "POST",
        body: JSON.stringify({ action: "verify", factorId: "f-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(eq).toHaveBeenCalledWith("id", "user-1");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mfa_verify", metadata: { factorId: "f-1" } }),
    );
  });

  it("handles unenrollment success", async () => {
    const unenroll = vi.fn().mockResolvedValue({ error: null });
    const listFactors = vi.fn().mockResolvedValue({
      data: { totp: [] },
      error: null,
    });
    const updateProfile = vi.fn().mockResolvedValue({ error: null });
    const eqProfile = vi.fn().mockReturnValue(updateProfile);
    const from = vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq: eqProfile }) });

    const mockSupabase = {
      auth: { mfa: { unenroll, listFactors } },
      from,
    } as unknown as SupabaseClient;

    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: mockSupabase });

    const req = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({ action: "unenroll", factorId: "f-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, mfa_enrolled: false });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mfa_unenroll",
        metadata: { factorId: "f-1" },
      }),
    );
  });

  it("calls errorResponse on unenroll failure", async () => {
    const unenroll = vi.fn().mockResolvedValue({ error: new Error("Unenroll failed") });
    const mockSupabase = {
      auth: { mfa: { unenroll } },
    } as unknown as SupabaseClient;

    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: mockSupabase });
    mockErrorResponse.mockReturnValue(new Response("error", { status: 500 }));

    const req = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({ action: "unenroll", factorId: "f-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("api/settings/mfa", expect.any(Error));
  });
});
