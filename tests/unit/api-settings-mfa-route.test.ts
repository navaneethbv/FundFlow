import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) =>
    NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 500 }),
}));

const mockWriteAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

import { POST } from "@/app/api/settings/mfa/route";

const USER_ID = "user-123";

function request(body?: unknown) {
  return new NextRequest("http://localhost/api/settings/mfa", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/settings/mfa", () => {
  it("rejects missing body, invalid action, or invalid factorId with 400", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: clientStub() });

    expect((await POST(request(null))).status).toBe(400);
    expect((await POST(request({ action: "invalid" }))).status).toBe(400);
    expect((await POST(request({ action: "enroll", factorId: 123 }))).status).toBe(400);
  });

  it("handles enroll action: factor not found", async () => {
    const listFactors = vi.fn().mockResolvedValue({
      data: { totp: [{ id: "f1", status: "verified" }] },
      error: null,
    });
    const supabase = {
      ...clientStub(),
      auth: { mfa: { listFactors } },
    };
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });

    const res = await POST(request({ action: "enroll", factorId: "missing-factor" }));
    expect(res.status).toBe(400);
  });

  it("unenrolls an over-limit factor even once it is already verified", async () => {
    // The client verifies before finalizing, so the refused factor arrives here
    // as "verified". Leaving it in place would keep an eleventh active factor
    // on the account while the response claims enrollment was refused.
    const totp = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `existing-${i}`, status: "verified" })),
      { id: "eleventh", status: "verified" },
    ];
    const unenroll = vi.fn().mockResolvedValue({ error: null });
    const listFactors = vi.fn().mockResolvedValue({ data: { totp }, error: null });
    const supabase = { ...clientStub(), auth: { mfa: { listFactors, unenroll } } };
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });

    const res = await POST(request({ action: "enroll", factorId: "eleventh" }));

    expect(res.status).toBe(400);
    expect(unenroll).toHaveBeenCalledWith({ factorId: "eleventh" });
  });

  it("allows the tenth factor through", async () => {
    const totp = [
      ...Array.from({ length: 9 }, (_, i) => ({ id: `existing-${i}`, status: "verified" })),
      { id: "tenth", status: "verified" },
    ];
    const unenroll = vi.fn().mockResolvedValue({ error: null });
    const listFactors = vi.fn().mockResolvedValue({ data: { totp }, error: null });
    const supabase = { ...clientStub(), auth: { mfa: { listFactors, unenroll } } };
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });

    const res = await POST(request({ action: "enroll", factorId: "tenth" }));

    expect(res.status).toBe(200);
    expect(unenroll).not.toHaveBeenCalled();
  });

  it("handles enroll action: over 10 factors limit", async () => {
    const totp = Array.from({ length: 11 }, (_, i) => ({ id: `f${i}`, status: "unverified" }));
    const unenroll = vi.fn().mockResolvedValue({ error: null });
    const listFactors = vi.fn().mockResolvedValue({
      data: { totp },
      error: null,
    });
    const supabase = {
      ...clientStub(),
      auth: { mfa: { listFactors, unenroll } },
    };
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });

    const res = await POST(request({ action: "enroll", factorId: "f0" }));
    expect(res.status).toBe(400);
    expect(unenroll).toHaveBeenCalledWith({ factorId: "f0" });
  });

  it("handles enroll action success", async () => {
    const listFactors = vi.fn().mockResolvedValue({
      data: { totp: [{ id: "f1", status: "verified" }] },
      error: null,
    });
    const supabase = {
      ...clientStub(),
      auth: { mfa: { listFactors } },
    };
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });

    const res = await POST(request({ action: "enroll", factorId: "f1" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, mfa_enrolled: true });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mfa_enroll", metadata: { factorId: "f1" } }),
    );
  });

  it("handles verify action: factor unverified", async () => {
    const listFactors = vi.fn().mockResolvedValue({
      data: { totp: [{ id: "f1", status: "unverified" }] },
      error: null,
    });
    const supabase = {
      ...clientStub(),
      auth: { mfa: { listFactors } },
    };
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });

    const res = await POST(request({ action: "verify", factorId: "f1" }));
    expect(res.status).toBe(400);
  });

  it("handles verify action success", async () => {
    const listFactors = vi.fn().mockResolvedValue({
      data: { totp: [{ id: "f1", status: "verified" }] },
      error: null,
    });
    const userClient = clientStub({ profiles: { data: { id: USER_ID } } });
    const supabase = {
      ...userClient,
      auth: { mfa: { listFactors } },
    };
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });

    const res = await POST(request({ action: "verify", factorId: "f1" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, mfa_enrolled: true });
    expect(userClient.writtenTo("profiles")).toEqual({ mfa_enrolled: true });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mfa_verify", metadata: { factorId: "f1" } }),
    );
  });

  it("handles unenroll action success", async () => {
    const unenroll = vi.fn().mockResolvedValue({ error: null });
    const listFactors = vi.fn().mockResolvedValue({
      data: { totp: [] },
      error: null,
    });
    const userClient = clientStub({ profiles: { data: { id: USER_ID } } });
    const supabase = {
      ...userClient,
      auth: { mfa: { listFactors, unenroll } },
    };
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });

    const res = await POST(request({ action: "unenroll", factorId: "f1" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, mfa_enrolled: false });
    expect(unenroll).toHaveBeenCalledWith({ factorId: "f1" });
    expect(userClient.writtenTo("profiles")).toEqual({ mfa_enrolled: false });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mfa_unenroll", metadata: { factorId: "f1" } }),
    );
  });

  it("returns 500 when Auth MFA listFactors or unenroll throws", async () => {
    const listFactors = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Auth service error" },
    });
    const supabase = {
      ...clientStub(),
      auth: { mfa: { listFactors } },
    };
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });

    const res = await POST(request({ action: "verify", factorId: "f1" }));
    expect(res.status).toBe(500);
  });
});
