import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockRequireUser = vi.fn();
const mockWriteAudit = vi.fn();
const mockErrorResponse = vi.fn();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (...args: unknown[]) => {
    mockErrorResponse(...args);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  },
}));
vi.mock("@/lib/audit", () => ({
  getClientIp: () => "127.0.0.1",
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

const mockListPasskeys = vi.fn();
const mockDeletePasskey = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        passkey: {
          listPasskeys: (...args: unknown[]) => mockListPasskeys(...args),
          deletePasskey: (...args: unknown[]) => mockDeletePasskey(...args),
        },
      },
    },
  }),
}));

import { POST } from "@/app/api/settings/passkeys/route";

describe("POST /api/settings/passkeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPasskeys.mockResolvedValue({
      data: [{ id: "passkey-1", friendly_name: "Touch ID" }],
      error: null,
    });
  });

  it("requires authentication and validates its narrow payload", async () => {
    const unauthorized = new NextResponse("Unauthorized", { status: 401 });
    mockRequireUser.mockResolvedValueOnce(unauthorized);
    expect(
      await POST(new NextRequest("http://localhost/api/settings/passkeys", { method: "POST" })),
    ).toBe(unauthorized);

    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    const response = await POST(
      new NextRequest("http://localhost/api/settings/passkeys", {
        method: "POST",
        body: JSON.stringify({ action: "register", passkeyId: "" }),
      }),
    );
    expect(response.status).toBe(400);

    const badActionRes = await POST(
      new NextRequest("http://localhost/api/settings/passkeys", {
        method: "POST",
        body: JSON.stringify({ action: "invalid_action", passkeyId: "p1" }),
      }),
    );
    expect(badActionRes.status).toBe(400);

    const badJsonRes = await POST(
      new NextRequest("http://localhost/api/settings/passkeys", {
        method: "POST",
        body: "bad json",
      }),
    );
    expect(badJsonRes.status).toBe(400);
  });

  it("confirms the passkey exists and records the audit for register/rename", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    const response = await POST(
      new NextRequest("http://localhost/api/settings/passkeys", {
        method: "POST",
        body: JSON.stringify({ action: "rename", passkeyId: "passkey-1", credential: "secret" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mockListPasskeys).toHaveBeenCalledWith({ userId: "user-1" });
    expect(mockDeletePasskey).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith({
      userId: "user-1",
      action: "passkey_rename",
      metadata: { passkeyId: "passkey-1" },
      ip: "127.0.0.1",
    });
  });

  it("rejects an action for a passkey the user does not own", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    const response = await POST(
      new NextRequest("http://localhost/api/settings/passkeys", {
        method: "POST",
        body: JSON.stringify({ action: "delete", passkeyId: "not-theirs" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mockDeletePasskey).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("deletes the passkey server-side and then records the audit", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    mockDeletePasskey.mockResolvedValue({ data: null, error: null });
    const response = await POST(
      new NextRequest("http://localhost/api/settings/passkeys", {
        method: "POST",
        body: JSON.stringify({ action: "delete", passkeyId: "passkey-1" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mockDeletePasskey).toHaveBeenCalledWith({
      userId: "user-1",
      passkeyId: "passkey-1",
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "passkey_delete", metadata: { passkeyId: "passkey-1" } }),
    );
  });

  it("returns an error when the admin delete fails", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    mockDeletePasskey.mockResolvedValue({ data: null, error: new Error("DB Error") });
    const response = await POST(
      new NextRequest("http://localhost/api/settings/passkeys", {
        method: "POST",
        body: JSON.stringify({ action: "delete", passkeyId: "passkey-1" }),
      }),
    );
    expect(response.status).toBe(500);
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});
