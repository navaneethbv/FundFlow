import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_ctx: unknown, error: unknown) =>
    NextResponse.json({ error: (error as Error).message }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockSafeEqual = vi.fn<(...args: unknown[]) => unknown>(() => true);
vi.mock("@/lib/crypto", () => ({
  safeEqual: (...args: unknown[]) => mockSafeEqual(...args),
}));

const mockLogError = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockWebhookVerificationKeyGet = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    webhookVerificationKeyGet: (...args: unknown[]) =>
      mockWebhookVerificationKeyGet(...args),
  }),
}));

const mockSyncItemTransactions = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/sync", () => ({
  syncItemTransactions: (...args: unknown[]) => mockSyncItemTransactions(...args),
}));

const mockSyncInvestmentsForItem = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/investment-sync", () => ({
  syncInvestmentsForItem: (...args: unknown[]) =>
    mockSyncInvestmentsForItem(...args),
}));

const mockGetItemByPlaidItemId = vi.fn<(...args: unknown[]) => unknown>();
const mockSetItemStatus = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid-service", () => ({
  getItemByPlaidItemId: (...args: unknown[]) => mockGetItemByPlaidItemId(...args),
  setItemStatus: (...args: unknown[]) => mockSetItemStatus(...args),
}));

const mockIsFeatureEnabled = vi.fn<(...args: unknown[]) => unknown>(() => true);
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

import { POST as webhookPost } from "@/app/api/plaid/webhook/route";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const jwk = publicKey.export({ format: "jwk" }) as {
  kty: string;
  crv: string;
  x: string;
  y: string;
};
const JWK = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };

function signedWebhook(
  body: unknown,
  opts: {
    header?: Record<string, unknown>;
    withIat?: boolean;
    iat?: number;
    requestHash?: string | null;
    signature?: Buffer | null;
    headerValue?: string | null;
  } = {},
): NextRequest {
  const bodyText = JSON.stringify(body);
  const header = opts.header ?? { kid: "r3-kid", alg: "ES256" };
  const payload: Record<string, unknown> = {};
  if (opts.requestHash !== null) {
    const hash =
      opts.requestHash ?? crypto.createHash("sha256").update(bodyText).digest("hex");
    payload.request_body_sha256 = hash;
  }
  if (opts.withIat !== false) payload.iat = opts.iat ?? Math.floor(Date.now() / 1000);
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig =
    opts.signature ??
    crypto.sign(
      "sha256",
      Buffer.from(`${headerB64}.${payloadB64}`),
      { key: privateKey, dsaEncoding: "ieee-p1363" },
    );
  const headerValue =
    opts.headerValue ?? `${headerB64}.${payloadB64}.${sig.toString("base64url")}`;
  return new NextRequest("http://localhost/api/plaid/webhook", {
    method: "POST",
    body: bodyText,
    headers: { "plaid-verification": headerValue },
  });
}

function plainWebhook(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/plaid/webhook", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function tamperedSignature(buf: Buffer): Buffer {
  const copy = Buffer.from(buf);
  copy[0] ^= 0xff;
  return copy;
}

describe("POST /api/plaid/webhook (r3-n3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebhookVerificationKeyGet.mockResolvedValue({ data: { key: JWK } });
    mockGetItemByPlaidItemId.mockResolvedValue(null);
    mockSyncInvestmentsForItem.mockResolvedValue(undefined);
    mockSyncItemTransactions.mockResolvedValue(undefined);
    mockSetItemStatus.mockResolvedValue(undefined);
    mockIsFeatureEnabled.mockReturnValue(true);
    mockSafeEqual.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("verification", () => {
    it("skips verification outside production when PLAID_ENV is sandbox", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(plainWebhook({}));
      expect(res.status).toBe(200);
      expect(mockWebhookVerificationKeyGet).not.toHaveBeenCalled();
    });

    it("does not skip verification when NODE_ENV is production even in sandbox", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(
        new NextRequest("http://localhost/api/plaid/webhook", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects a webhook with no verification header in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const res = await webhookPost(
        new NextRequest("http://localhost/api/plaid/webhook", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Invalid signature" });
    });

    it("rejects a header with the wrong number of parts", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const res = await webhookPost(
        signedWebhook({}, { headerValue: "a.b" }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects a header missing a kid", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const res = await webhookPost(
        signedWebhook({}, { header: { alg: "ES256" } }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects a header whose alg is not ES256", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const res = await webhookPost(
        signedWebhook({}, { header: { kid: "k1", alg: "RS256" } }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects a payload without an iat (stale)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const res = await webhookPost(signedWebhook({}, { withIat: false }));
      expect(res.status).toBe(401);
    });

    it("rejects a payload with an old iat (replay)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const res = await webhookPost(
        signedWebhook({}, { iat: Math.floor(Date.now() / 1000) - 3600 }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects when the request body hash does not match", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      mockSafeEqual.mockReturnValue(false);
      const res = await webhookPost(signedWebhook({ webhook_type: "BALANCE" }));
      expect(res.status).toBe(401);
      expect(mockSafeEqual).toHaveBeenCalled();
    });

    it("rejects a payload without a request_body_sha256", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const res = await webhookPost(
        signedWebhook({ webhook_type: "BALANCE" }, { requestHash: null }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects a validly shaped but tampered signature", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const base = signedWebhook({ webhook_type: "BALANCE" });
      const headerValue = base.headers.get("plaid-verification") as string;
      const [h, p, s] = headerValue.split(".");
      const badSig = tamperedSignature(Buffer.from(s, "base64url")).toString("base64url");
      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({ webhook_type: "BALANCE" }),
        headers: { "plaid-verification": `${h}.${p}.${badSig}` },
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(401);
    });

    it("accepts a valid signed webhook and caches the verification key by kid", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const req = signedWebhook(
        { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" },
        { header: { kid: "cache-kid", alg: "ES256" } },
      );
      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      expect(mockWebhookVerificationKeyGet).toHaveBeenCalledTimes(1);

      const req2 = signedWebhook(
        { webhook_type: "BALANCE" },
        { header: { kid: "cache-kid", alg: "ES256" } },
      );
      const res2 = await webhookPost(req2);
      expect(res2.status).toBe(200);
      expect(mockWebhookVerificationKeyGet).toHaveBeenCalledTimes(1);
    });

    it("does not cache an expired verification key", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      mockWebhookVerificationKeyGet.mockResolvedValue({
        data: { key: { ...JWK, expired_at: "2026-01-01T00:00:00Z" } },
      });
      for (let i = 0; i < 2; i++) {
        const req = signedWebhook(
          { webhook_type: "BALANCE" },
          { header: { kid: "expired-kid", alg: "ES256" } },
        );
        const res = await webhookPost(req);
        expect(res.status).toBe(200);
      }
      expect(mockWebhookVerificationKeyGet).toHaveBeenCalledTimes(2);
    });

    it("logs and rejects when the verification key fetch fails", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      mockWebhookVerificationKeyGet.mockRejectedValue(new Error("key fetch failed"));
      const res = await webhookPost(
        signedWebhook({ webhook_type: "BALANCE" }, { header: { kid: "boom-kid", alg: "ES256" } }),
      );
      expect(res.status).toBe(401);
      expect(mockLogError).toHaveBeenCalledWith("webhook.verify", expect.any(Error));
    });

    it("logs and rejects when the verification header is not parseable", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const res = await webhookPost(
        signedWebhook({}, { headerValue: "bm90LWpzb24=.cGF5bG9hZA.c2ln" }),
      );
      expect(res.status).toBe(401);
      expect(mockLogError).toHaveBeenCalledWith("webhook.verify", expect.any(Error));
    });
  });

  describe("TRANSACTIONS handling", () => {
    it("rejects a TRANSACTIONS/SYNC webhook with no item_id", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(
        plainWebhook({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" }),
      );
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Missing item_id in webhook body");
    });

    it("ignores a TRANSACTIONS webhook whose code is not SYNC_UPDATES_AVAILABLE", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(
        plainWebhook({ webhook_type: "TRANSACTIONS", webhook_code: "INITIAL_UPDATE", item_id: "i1" }),
      );
      expect(res.status).toBe(200);
      expect(mockSyncItemTransactions).not.toHaveBeenCalled();
    });

    it("ignores a non-TRANSACTIONS webhook for the transaction handler", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(plainWebhook({ webhook_type: "BALANCE", item_id: "i1" }));
      expect(res.status).toBe(200);
      expect(mockSyncItemTransactions).not.toHaveBeenCalled();
    });

    it("ignores a TRANSACTIONS webhook whose item_id is not a string", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(
        plainWebhook({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: 123 }),
      );
      expect(res.status).toBe(200);
      expect(mockSyncItemTransactions).not.toHaveBeenCalled();
    });

    it("syncs transactions when the item exists", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item" });
      const res = await webhookPost(
        plainWebhook({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "i1" }),
      );
      expect(res.status).toBe(200);
      expect(mockGetItemByPlaidItemId).toHaveBeenCalledWith("i1");
      expect(mockSyncItemTransactions).toHaveBeenCalledWith({ id: "db-item" });
    });

    it("does not sync when the item is missing", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(
        plainWebhook({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "missing" }),
      );
      expect(res.status).toBe(200);
      expect(mockSyncItemTransactions).not.toHaveBeenCalled();
    });
  });

  describe("HOLDINGS handling", () => {
    it("ignores a non-HOLDINGS webhook", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(plainWebhook({ webhook_type: "BALANCE", item_id: "i1" }));
      expect(res.status).toBe(200);
      expect(mockSyncInvestmentsForItem).not.toHaveBeenCalled();
    });

    it("ignores a HOLDINGS webhook with an unrecognized code", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(
        plainWebhook({ webhook_type: "HOLDINGS", webhook_code: "OTHER", item_id: "i1" }),
      );
      expect(res.status).toBe(200);
      expect(mockSyncInvestmentsForItem).not.toHaveBeenCalled();
    });

    it("ignores a HOLDINGS webhook when the investments page flag is off", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockIsFeatureEnabled.mockReturnValue(false);
      const res = await webhookPost(
        plainWebhook({ webhook_type: "HOLDINGS", webhook_code: "DEFAULT_UPDATE", item_id: "i1" }),
      );
      expect(res.status).toBe(200);
      expect(mockSyncInvestmentsForItem).not.toHaveBeenCalled();
    });

    it("ignores a HOLDINGS webhook when the item is missing", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(
        plainWebhook({ webhook_type: "HOLDINGS", webhook_code: "HISTORICAL_UPDATE", item_id: "missing" }),
      );
      expect(res.status).toBe(200);
      expect(mockSyncInvestmentsForItem).not.toHaveBeenCalled();
    });

    it("syncs investments for a DEFAULT_UPDATE webhook", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item" });
      const res = await webhookPost(
        plainWebhook({ webhook_type: "HOLDINGS", webhook_code: "DEFAULT_UPDATE", item_id: "i1" }),
      );
      expect(res.status).toBe(200);
      expect(mockSyncInvestmentsForItem).toHaveBeenCalledWith({ id: "db-item" });
    });

    it("swallows a rejected holdings sync and logs it", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item" });
      mockSyncInvestmentsForItem.mockRejectedValue(new Error("holdings boom"));
      const res = await webhookPost(
        plainWebhook({ webhook_type: "HOLDINGS", webhook_code: "HISTORICAL_UPDATE", item_id: "i1" }),
      );
      expect(res.status).toBe(200);
      expect(mockLogError).toHaveBeenCalledWith("webhook.holdings", expect.any(Error));
    });
  });

  describe("ITEM handling", () => {
    it("ignores a non-ITEM webhook", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(plainWebhook({ webhook_type: "BALANCE", item_id: "i1" }));
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).not.toHaveBeenCalled();
    });

    it("ignores an ITEM webhook whose item_id is not a string", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(plainWebhook({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: 42 }));
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).not.toHaveBeenCalled();
    });

    it("ignores an ITEM webhook with an empty item_id", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(plainWebhook({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: "" }));
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).not.toHaveBeenCalled();
    });

    it("does nothing when the item is missing", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const res = await webhookPost(plainWebhook({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: "missing" }));
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).not.toHaveBeenCalled();
    });

    it("marks the item in error with the plaid error code", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item" });
      const res = await webhookPost(
        plainWebhook({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: "i1", error: { error_code: "ITEM_LOGIN_REQUIRED" } }),
      );
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).toHaveBeenCalledWith("db-item", "error", "ITEM_LOGIN_REQUIRED");
    });

    it("falls back to ITEM_ERROR when no error code is present", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item" });
      const res = await webhookPost(
        plainWebhook({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: "i1" }),
      );
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).toHaveBeenCalledWith("db-item", "error", "ITEM_ERROR");
    });

    it("handles PENDING_EXPIRATION", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item" });
      const res = await webhookPost(
        plainWebhook({ webhook_type: "ITEM", webhook_code: "PENDING_EXPIRATION", item_id: "i1" }),
      );
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).toHaveBeenCalledWith("db-item", "active", "PENDING_EXPIRATION");
    });

    it("handles LOGIN_REPAIRED", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item" });
      const res = await webhookPost(
        plainWebhook({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED", item_id: "i1" }),
      );
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).toHaveBeenCalledWith("db-item", "active", null);
    });

    it("handles USER_PERMISSION_REVOKED", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item" });
      const res = await webhookPost(
        plainWebhook({ webhook_type: "ITEM", webhook_code: "USER_PERMISSION_REVOKED", item_id: "i1" }),
      );
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).toHaveBeenCalledWith("db-item", "disconnected", "USER_PERMISSION_REVOKED");
    });

    it("ignores an ITEM webhook with an unrecognized code", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item" });
      const res = await webhookPost(
        plainWebhook({ webhook_type: "ITEM", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "i1" }),
      );
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).not.toHaveBeenCalled();
    });
  });

  describe("POST error handling", () => {
    it("returns an error response when the body is not JSON", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: "not json",
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("api/plaid/webhook", expect.any(Error));
    });

    it("returns an error response when reading the body fails", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const req = {
        text: () => Promise.reject(new Error("read failed")),
      } as unknown as NextRequest;
      const res = await webhookPost(req);
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("api/plaid/webhook", expect.any(Error));
    });

    it("verifies a signed valid webhook end-to-end", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item" });
      const req = signedWebhook(
        { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" },
        { header: { kid: "final-kid", alg: "ES256" } },
      );
      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(mockSyncItemTransactions).toHaveBeenCalledWith({ id: "db-item" });
    });
  });
});