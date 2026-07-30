import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

const mockGetItemByPlaidItemId = vi.fn();
const mockSetItemStatus = vi.fn();
vi.mock("@/lib/plaid-service", () => ({
  getItemByPlaidItemId: (...args: unknown[]) => mockGetItemByPlaidItemId(...args),
  setItemStatus: (...args: unknown[]) => mockSetItemStatus(...args),
}));

const mockSyncItemTransactions = vi.fn();
vi.mock("@/lib/sync", () => ({
  syncItemTransactions: (...args: unknown[]) => mockSyncItemTransactions(...args),
}));

const mockErrorResponse = vi.fn();
const mockBadRequest = vi.fn();
vi.mock("@/lib/http", () => ({
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (msg: string) => {
    mockBadRequest(msg);
    return new Response(JSON.stringify({ error: msg }), { status: 400 });
  },
}));

import { POST } from "@/app/api/plaid/webhook/route";
import { NextRequest } from "next/server";

describe("POST /api/plaid/webhook", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllEnvs();
  });

  const sampleItem = {
    id: "item-db-1",
    user_id: "user-1",
    plaid_item_id: "plaid-item-1",
    status: "active",
  };

  it("handles TRANSACTIONS SYNC_UPDATES_AVAILABLE webhook", async () => {
    mockGetItemByPlaidItemId.mockResolvedValue(sampleItem);
    mockSyncItemTransactions.mockResolvedValue({ added: 1, modified: 0, removed: 0 });

    const req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "plaid-item-1",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(mockGetItemByPlaidItemId).toHaveBeenCalledWith("plaid-item-1");
    expect(mockSyncItemTransactions).toHaveBeenCalledWith(sampleItem);
  });

  it("returns badRequest if item_id is missing in TRANSACTIONS webhook", async () => {
    const req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Missing item_id in webhook body");
  });

  it("handles ITEM ERROR webhook and sets error status", async () => {
    mockGetItemByPlaidItemId.mockResolvedValue(sampleItem);

    const req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "ITEM",
        webhook_code: "ERROR",
        item_id: "plaid-item-1",
        error: { error_code: "ITEM_LOGIN_REQUIRED" },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSetItemStatus).toHaveBeenCalledWith("item-db-1", "error", "ITEM_LOGIN_REQUIRED");
  });

  it("handles ITEM PENDING_EXPIRATION, LOGIN_REPAIRED, and USER_PERMISSION_REVOKED webhooks", async () => {
    mockGetItemByPlaidItemId.mockResolvedValue(sampleItem);

    // PENDING_EXPIRATION
    let req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "ITEM",
        webhook_code: "PENDING_EXPIRATION",
        item_id: "plaid-item-1",
      }),
    });
    await POST(req);
    expect(mockSetItemStatus).toHaveBeenCalledWith("item-db-1", "active", "PENDING_EXPIRATION");

    // LOGIN_REPAIRED
    req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "ITEM",
        webhook_code: "LOGIN_REPAIRED",
        item_id: "plaid-item-1",
      }),
    });
    await POST(req);
    expect(mockSetItemStatus).toHaveBeenCalledWith("item-db-1", "active", null);

    // USER_PERMISSION_REVOKED
    req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "ITEM",
        webhook_code: "USER_PERMISSION_REVOKED",
        item_id: "plaid-item-1",
      }),
    });
    await POST(req);
    expect(mockSetItemStatus).toHaveBeenCalledWith("item-db-1", "disconnected", "USER_PERMISSION_REVOKED");
  });

  it("returns 401 when signature verification fails in production mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.PLAID_ENV = "production";

    // 1. Missing header
    let req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({ webhook_type: "TRANSACTIONS" }),
    });
    let res = await POST(req);
    expect(res.status).toBe(401);

    // 2. Malformed header (not 3 parts)
    req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      headers: { "plaid-verification": "invalid.header" },
      body: JSON.stringify({ webhook_type: "TRANSACTIONS" }),
    });
    res = await POST(req);
    expect(res.status).toBe(401);

    // 3. Header missing kid
    const invalidHeaderB64 = Buffer.from(JSON.stringify({ alg: "ES256" })).toString("base64url");
    req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      headers: { "plaid-verification": `${invalidHeaderB64}.payload.sig` },
      body: JSON.stringify({ webhook_type: "TRANSACTIONS" }),
    });
    res = await POST(req);
    expect(res.status).toBe(401);

    // 4. Header with invalid alg
    const invalidAlgB64 = Buffer.from(JSON.stringify({ kid: "key-1", alg: "RS256" })).toString("base64url");
    req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      headers: { "plaid-verification": `${invalidAlgB64}.payload.sig` },
      body: JSON.stringify({ webhook_type: "TRANSACTIONS" }),
    });
    res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("verifies genuine Plaid signature in production mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.PLAID_ENV = "production";

    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" });
    const mockPlaid = {
      webhookVerificationKeyGet: vi.fn().mockResolvedValue({ data: { key: { ...jwk, expired_at: null } } }),
    };
    const plaidModule = await import("@/lib/plaid");
    vi.spyOn(plaidModule, "getPlaidClient").mockReturnValue(
      mockPlaid as unknown as ReturnType<typeof plaidModule.getPlaidClient>
    );

    const bodyText = JSON.stringify({
      webhook_type: "ITEM",
      webhook_code: "LOGIN_REPAIRED",
      item_id: "plaid-item-1",
    });
    mockGetItemByPlaidItemId.mockResolvedValue(sampleItem);

    const bodyHash = crypto.createHash("sha256").update(bodyText).digest("hex");
    const headerObj = { kid: "key-ec-1", alg: "ES256" };
    const payloadObj = { iat: Math.floor(Date.now() / 1000), request_body_sha256: bodyHash };

    const headerB64 = Buffer.from(JSON.stringify(headerObj)).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
    const signingInput = `${headerB64}.${payloadB64}`;

    const signature = crypto.sign(
      "sha256",
      Buffer.from(signingInput),
      { key: privateKey, dsaEncoding: "ieee-p1363" }
    );
    const signatureB64 = signature.toString("base64url");
    const token = `${headerB64}.${payloadB64}.${signatureB64}`;

    const req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      headers: { "plaid-verification": token },
      body: bodyText,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSetItemStatus).toHaveBeenCalledWith("item-db-1", "active", null);
  });

  it("rejects replayed webhooks with old timestamp", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.PLAID_ENV = "production";

    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" });
    const mockPlaid = {
      webhookVerificationKeyGet: vi.fn().mockResolvedValue({ data: { key: { ...jwk, expired_at: "2026-01-01" } } }),
    };
    const plaidModule = await import("@/lib/plaid");
    vi.spyOn(plaidModule, "getPlaidClient").mockReturnValue(
      mockPlaid as unknown as ReturnType<typeof plaidModule.getPlaidClient>
    );

    const bodyText = JSON.stringify({ webhook_type: "ITEM" });
    const bodyHash = crypto.createHash("sha256").update(bodyText).digest("hex");
    const headerObj = { kid: "key-ec-2", alg: "ES256" };
    // Timestamp 10 minutes ago
    const payloadObj = { iat: Math.floor(Date.now() / 1000) - 600, request_body_sha256: bodyHash };

    const headerB64 = Buffer.from(JSON.stringify(headerObj)).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
    const signingInput = `${headerB64}.${payloadB64}`;

    const signature = crypto.sign(
      "sha256",
      Buffer.from(signingInput),
      { key: privateKey, dsaEncoding: "ieee-p1363" }
    );
    const token = `${headerB64}.${payloadB64}.${signature.toString("base64url")}`;

    const req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      headers: { "plaid-verification": token },
      body: bodyText,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("calls errorResponse when processing throws error", async () => {
    const req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: "invalid-json",
    });

    mockErrorResponse.mockReturnValue(new Response("error", { status: 500 }));
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("api/plaid/webhook", expect.any(Error));
  });
});
