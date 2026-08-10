import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockRequireUser = vi.fn();
const mockWriteAudit = vi.fn();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
}));
vi.mock("@/lib/audit", () => ({
  getClientIp: () => "127.0.0.1",
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

import { POST } from "@/app/api/settings/passkeys/route";

describe("POST /api/settings/passkeys", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("records only the action and passkey id", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    const response = await POST(
      new NextRequest("http://localhost/api/settings/passkeys", {
        method: "POST",
        body: JSON.stringify({ action: "rename", passkeyId: "passkey-1", credential: "secret" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mockWriteAudit).toHaveBeenCalledWith({
      userId: "user-1",
      action: "passkey_rename",
      metadata: { passkeyId: "passkey-1" },
      ip: "127.0.0.1",
    });
  });
});
