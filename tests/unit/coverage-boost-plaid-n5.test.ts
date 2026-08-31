import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";
import crypto from "node:crypto";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_ctx: unknown, error: unknown) =>
    NextResponse.json({ error: (error as Error).message }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockIsAllowedPushEndpoint = vi.fn<(...args: unknown[]) => unknown>(
  () => true,
);
vi.mock("@/lib/push", () => ({
  isAllowedPushEndpoint: (...args: unknown[]) => mockIsAllowedPushEndpoint(...args),
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
    webhookVerificationKeyGet: (...args: unknown[]) => mockWebhookVerificationKeyGet(...args),
  }),
}));

const mockSyncItemTransactions = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/sync", () => ({
  syncItemTransactions: (...args: unknown[]) => mockSyncItemTransactions(...args),
}));

const mockRefreshRecurringForItem = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/recurring", () => ({
  refreshRecurringForItem: (...args: unknown[]) => mockRefreshRecurringForItem(...args),
}));

const mockRefreshInferredRecurringForItem = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/recurring-inference", () => ({
  refreshInferredRecurringForItem: (...args: unknown[]) =>
    mockRefreshInferredRecurringForItem(...args),
}));

const mockSyncInvestmentsForItem = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/investment-sync", () => ({
  syncInvestmentsForItem: (...args: unknown[]) => mockSyncInvestmentsForItem(...args),
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
import { POST as subscribePost, DELETE as subscribeDelete } from "@/app/api/push/subscribe/route";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const JWK = publicKey.export({ format: "jwk" });

function signedRequest(body: Record<string, unknown>, withIat = true, kid = "test-kid") {
  const bodyText = JSON.stringify(body);
  const header = { kid, alg: "ES256" };
  const payload: Record<string, unknown> = {
    request_body_sha256: crypto.createHash("sha256").update(bodyText).digest("hex"),
  };
  if (withIat) payload.iat = Math.floor(Date.now() / 1000);
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.sign(
    "sha256",
    Buffer.from(`${headerB64}.${payloadB64}`),
    { key: privateKey, dsaEncoding: "ieee-p1363" },
  );
  return new NextRequest("http://localhost/api/plaid/webhook", {
    method: "POST",
    body: bodyText,
    headers: {
      "plaid-verification": `${headerB64}.${payloadB64}.${sig.toString("base64url")}`,
    },
  });
}

describe("coverage-boost-plaid-n5", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    mockWebhookVerificationKeyGet.mockResolvedValue({ data: { key: JWK } });
    mockGetItemByPlaidItemId.mockResolvedValue(null);
    mockSyncInvestmentsForItem.mockResolvedValue(undefined);
    mockIsFeatureEnabled.mockReturnValue(true);
    mockIsAllowedPushEndpoint.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("POST /api/plaid/webhook", () => {
    it("returns 401 when no verification header is present in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 when the verification header is malformed", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "plaid-verification": "garbage" },
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 when the signature payload is stale (no iat)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const req = signedRequest({ webhook_type: "BALANCE" }, false);
      const res = await webhookPost(req);
      expect(res.status).toBe(401);
    });

    it("logs and returns 401 when the verification key fetch fails", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      mockWebhookVerificationKeyGet.mockRejectedValue(new Error("key fetch failed"));
      const req = signedRequest({ webhook_type: "BALANCE" }, true, "fail-kid");
      const res = await webhookPost(req);
      expect(res.status).toBe(401);
      expect(mockLogError).toHaveBeenCalledWith("webhook.verify", expect.any(Error));
    });

    it("verifies a signed TRANSACTIONS webhook and syncs", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item", user_id: "user-1" });
      const req = signedRequest(
        { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-123" },
        true,
      );
      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      expect(mockSyncItemTransactions).toHaveBeenCalledWith({ id: "db-item", user_id: "user-1" });
    });

    it("reuses the cached verification key for a second signed webhook", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const callsBefore = mockWebhookVerificationKeyGet.mock.calls.length;
      const req = signedRequest(
        { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-123" },
        true,
      );
      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      expect(mockWebhookVerificationKeyGet.mock.calls).toHaveLength(callsBefore);
    });

    it("returns 400 when a TRANSACTIONS webhook has no item_id", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PLAID_ENV", "production");
      const req = signedRequest(
        { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" },
        true,
      );
      const res = await webhookPost(req);
      expect(res.status).toBe(400);
    });

    it("syncs investments for a HOLDINGS webhook when the item exists", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item", user_id: "user-1" });
      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({ webhook_type: "HOLDINGS", webhook_code: "DEFAULT_UPDATE", item_id: "item-123" }),
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      expect(mockSyncInvestmentsForItem).toHaveBeenCalledWith({ id: "db-item", user_id: "user-1" });
    });

    it("does nothing for a HOLDINGS webhook when the item is missing", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({ webhook_type: "HOLDINGS", webhook_code: "HISTORICAL_UPDATE", item_id: "item-123" }),
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      expect(mockSyncInvestmentsForItem).not.toHaveBeenCalled();
    });

    it("handles an ITEM PENDING_EXPIRATION webhook", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item", user_id: "user-1" });
      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({ webhook_type: "ITEM", webhook_code: "PENDING_EXPIRATION", item_id: "item-123" }),
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).toHaveBeenCalledWith("user-1", "db-item", "active", "PENDING_EXPIRATION");
    });

    it("handles an ITEM LOGIN_REPAIRED webhook", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      mockGetItemByPlaidItemId.mockResolvedValue({ id: "db-item", user_id: "user-1" });
      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED", item_id: "item-123" }),
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).toHaveBeenCalledWith("user-1", "db-item", "active", null);
    });

    it("skips ITEM handling when the item is missing", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: "item-123", error: { error_code: "X" } }),
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).not.toHaveBeenCalled();
    });

    it("returns errorResponse when body parsing throws", async () => {
      vi.stubEnv("PLAID_ENV", "sandbox");
      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: "not json",
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/push/subscribe", () => {
    const subSupabase = (fromImpl: unknown) => ({
      from: vi.fn().mockReturnValue(fromImpl),
    });

    it("returns auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await subscribePost({} as NextRequest);
      expect(res.status).toBe(401);
    });

    it("returns bad request when subscription fields are missing", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: subSupabase({}) });
      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await subscribePost(req);
      expect(res.status).toBe(400);
    });

    it("returns bad request for an unsupported endpoint", async () => {
      mockIsAllowedPushEndpoint.mockReturnValue(false);
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: subSupabase({}) });
      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: "https://x.example.com", keys: { p256dh: "a", auth: "b" } }),
      });
      const res = await subscribePost(req);
      expect(res.status).toBe(400);
    });

    it("subscribes successfully", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: subSupabase({ upsert: vi.fn().mockResolvedValue({ error: null }) }),
      });
      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "a", auth: "b" } }),
      });
      const res = await subscribePost(req);
      expect(res.status).toBe(200);
    });

    it("returns errorResponse when upsert fails", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: subSupabase({ upsert: vi.fn().mockResolvedValue({ error: { message: "db" } }) }),
      });
      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "a", auth: "b" } }),
      });
      const res = await subscribePost(req);
      expect(res.status).toBe(500);
    });
  });

  describe("DELETE /api/push/subscribe", () => {
    const delChain = (error: unknown) => {
      const chain = {
        then: (r: (v: unknown) => unknown) => r({ error }),
        delete: () => chain,
        eq: () => chain,
      };
      return chain;
    };

    it("returns auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await subscribeDelete({} as NextRequest);
      expect(res.status).toBe(401);
    });

    it("returns bad request when endpoint is missing", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: { from: vi.fn() } });
      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      const res = await subscribeDelete(req);
      expect(res.status).toBe(400);
    });

    it("unsubscribes successfully", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: { from: vi.fn().mockReturnValue(delChain(null)) },
      });
      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/x" }),
      });
      const res = await subscribeDelete(req);
      expect(res.status).toBe(200);
    });

    it("returns errorResponse when delete fails", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: { from: vi.fn().mockReturnValue(delChain({ message: "db" })) },
      });
      const req = new NextRequest("http://localhost/api/push/subscribe", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/x" }),
      });
      const res = await subscribeDelete(req);
      expect(res.status).toBe(500);
    });
  });
});
