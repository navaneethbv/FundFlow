import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";

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

const envState = vi.hoisted(() => ({
  appUrl: "https://app.example.com",
  plaidRedirectUri: null as string | null,
  plaidCountryCodes: ["US"],
  plaidProducts: ["transactions"],
}));
vi.mock("@/lib/env.server", () => ({ serverEnv: envState }));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(
  () => Promise.resolve(true),
);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockLogError = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockLinkTokenGet = vi.fn<(...args: unknown[]) => unknown>();
const mockItemPublicTokenExchange = vi.fn<(...args: unknown[]) => unknown>();
const mockItemGet = vi.fn<(...args: unknown[]) => unknown>();
const mockAccountsGet = vi.fn<(...args: unknown[]) => unknown>();
const mockLinkTokenCreate = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    linkTokenGet: (...args: unknown[]) => mockLinkTokenGet(...args),
    itemPublicTokenExchange: (...args: unknown[]) => mockItemPublicTokenExchange(...args),
    itemGet: (...args: unknown[]) => mockItemGet(...args),
    accountsGet: (...args: unknown[]) => mockAccountsGet(...args),
    linkTokenCreate: (...args: unknown[]) => mockLinkTokenCreate(...args),
  }),
}));

const mockStoreItem = vi.fn<(...args: unknown[]) => unknown>();
const mockGetItem = vi.fn<(...args: unknown[]) => unknown>();
const mockUpsertAccounts = vi.fn<(...args: unknown[]) => unknown>();
const mockConsumeLinkToken = vi.fn<(...args: unknown[]) => unknown>();
const mockStoreLinkToken = vi.fn<(...args: unknown[]) => unknown>();
const mockDecryptItemToken = vi.fn<(...args: unknown[]) => unknown>(
  () => "decrypted-token",
);
const mockSetItemStatus = vi.fn<(...args: unknown[]) => unknown>();
const mockUpdateItemBranding = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid-service", () => ({
  storeItem: (...args: unknown[]) => mockStoreItem(...args),
  getItem: (...args: unknown[]) => mockGetItem(...args),
  upsertAccounts: (...args: unknown[]) => mockUpsertAccounts(...args),
  consumeLinkToken: (...args: unknown[]) => mockConsumeLinkToken(...args),
  storeLinkToken: (...args: unknown[]) => mockStoreLinkToken(...args),
  decryptItemToken: (...args: unknown[]) => mockDecryptItemToken(...args),
  setItemStatus: (...args: unknown[]) => mockSetItemStatus(...args),
  updateItemBranding: (...args: unknown[]) => mockUpdateItemBranding(...args),
}));

const mockSyncItemTransactions = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/sync", () => ({
  syncItemTransactions: (...args: unknown[]) => mockSyncItemTransactions(...args),
}));

const mockFetchInstitutionBranding = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid-institution", () => ({
  fetchInstitutionBranding: (...args: unknown[]) => mockFetchInstitutionBranding(...args),
}));

const mockRequireOwnedItem = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid-item-route", () => ({
  requireOwnedItem: (...args: unknown[]) => mockRequireOwnedItem(...args),
}));

import { POST as exchangePost } from "@/app/api/plaid/exchange/route";
import { POST as linkTokenPost } from "@/app/api/plaid/link-token/route";
import { POST as reconnectPost } from "@/app/api/plaid/reconnect/route";

const USER = { user: { id: "user-1", email: "u@e.com" } };

describe("coverage-boost-plaid-n4", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(USER);
    mockCheckRateLimit.mockResolvedValue(true);
    mockConsumeLinkToken.mockResolvedValue(true);
    mockLinkTokenGet.mockResolvedValue({ data: {} });
    mockItemPublicTokenExchange.mockResolvedValue({
      data: { access_token: "access-1", item_id: "plaid-item-1" },
    });
    mockItemGet.mockResolvedValue({ data: { item: { institution_id: null } } });
    mockAccountsGet.mockResolvedValue({ data: { accounts: [] } });
    mockStoreItem.mockResolvedValue("item-db-1");
    mockGetItem.mockResolvedValue(null);
    mockSyncItemTransactions.mockResolvedValue(undefined);
    mockUpsertAccounts.mockResolvedValue(undefined);
    mockFetchInstitutionBranding.mockResolvedValue({
      name: "Bank",
      logo: null,
      brandColor: null,
    });
    mockLinkTokenCreate.mockResolvedValue({
      data: { link_token: "link-token-1", expiration: null },
    });
    mockRequireOwnedItem.mockResolvedValue({
      ok: true,
      user: { id: "user-1" },
      item: { id: "item-1", institution_id: "inst-1", institution_name: "Chase" },
    });
    envState.appUrl = "https://app.example.com";
    envState.plaidRedirectUri = null;
  });

  describe("POST /api/plaid/exchange", () => {
    it("returns auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await exchangePost({} as NextRequest);
      expect(res.status).toBe(401);
    });

    it("returns 429 when rate limited", async () => {
      mockCheckRateLimit.mockResolvedValue(false);
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "p", link_token: "l" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(429);
    });

    it("returns bad request for invalid JSON", async () => {
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: "not json",
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(400);
    });

    it("returns bad request when public_token is missing", async () => {
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ link_token: "l" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(400);
    });

    it("returns bad request when link_token is missing", async () => {
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "p" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(400);
    });

    it("logs and continues when linkTokenGet throws", async () => {
      mockLinkTokenGet.mockRejectedValue(new Error("plaid lag"));
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "p", link_token: "l" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(200);
      expect(mockLogError).toHaveBeenCalledWith("plaid.exchange.linkTokenGet", expect.any(Error));
    });

    it("handles a link session with no link_sessions field", async () => {
      mockLinkTokenGet.mockResolvedValue({ data: {} });
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "p", link_token: "l" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(200);
    });

    it("returns bad request when consumeLinkToken fails", async () => {
      mockConsumeLinkToken.mockResolvedValue(false);
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "p", link_token: "l" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(400);
    });

    it("uses null institution name when branding returns null", async () => {
      mockItemGet.mockResolvedValue({ data: { item: { institution_id: "inst-9" } } });
      mockFetchInstitutionBranding.mockResolvedValue(null);
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "p", link_token: "l" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, institution_name: null });
    });

    it("completes a full successful exchange", async () => {
      mockItemGet.mockResolvedValue({ data: { item: { institution_id: "inst-1" } } });
      mockFetchInstitutionBranding.mockResolvedValue({ name: "Chase", logo: null, brandColor: null });
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "p", link_token: "l" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, institution_name: "Chase" });
      expect(mockStoreItem).toHaveBeenCalled();
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "plaid_connect" }),
      );
    });

    it("returns errorResponse when the exchange throws", async () => {
      mockItemPublicTokenExchange.mockRejectedValue(new Error("exchange down"));
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "p", link_token: "l" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/plaid/link-token", () => {
    it("returns auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await linkTokenPost({} as NextRequest);
      expect(res.status).toBe(401);
    });

    it("returns 429 when rate limited", async () => {
      mockCheckRateLimit.mockResolvedValue(false);
      const req = new NextRequest("http://localhost/api/plaid/link-token", { method: "POST" });
      const res = await linkTokenPost(req);
      expect(res.status).toBe(429);
    });

    it("creates a link token with an https webhook", async () => {
      const req = new NextRequest("http://localhost/api/plaid/link-token", { method: "POST" });
      const res = await linkTokenPost(req);
      expect(res.status).toBe(200);
      expect(mockStoreLinkToken).toHaveBeenCalledWith("user-1", "link-token-1", null);
      expect(mockLinkTokenCreate).toHaveBeenCalledWith(
        expect.objectContaining({ webhook: "https://app.example.com/api/plaid/webhook" }),
      );
    });

    it("skips the webhook when appUrl is not https", async () => {
      envState.appUrl = "http://localhost:3000";
      const req = new NextRequest("http://localhost/api/plaid/link-token", { method: "POST" });
      const res = await linkTokenPost(req);
      expect(res.status).toBe(200);
      const call = mockLinkTokenCreate.mock.calls.at(-1)![0] as { webhook?: unknown };
      expect(call.webhook).toBeUndefined();
    });

    it("sets redirect_uri when plaidRedirectUri is configured", async () => {
      envState.plaidRedirectUri = "https://app.example.com/oauth";
      const req = new NextRequest("http://localhost/api/plaid/link-token", { method: "POST" });
      const res = await linkTokenPost(req);
      expect(res.status).toBe(200);
      expect(mockLinkTokenCreate).toHaveBeenCalledWith(
        expect.objectContaining({ redirect_uri: "https://app.example.com/oauth" }),
      );
    });

    it("creates an update-mode link token for an existing item", async () => {
      mockGetItem.mockResolvedValue({ id: "item-1" });
      const req = new NextRequest("http://localhost/api/plaid/link-token", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await linkTokenPost(req);
      expect(res.status).toBe(200);
      expect(mockDecryptItemToken).toHaveBeenCalled();
      const call = mockLinkTokenCreate.mock.calls.at(-1)![0] as { products?: unknown };
      expect(call.products).toBeUndefined();
    });

    it("returns 404 in update mode when the item is missing", async () => {
      mockGetItem.mockResolvedValue(null);
      const req = new NextRequest("http://localhost/api/plaid/link-token", {
        method: "POST",
        body: JSON.stringify({ item_id: "nope" }),
      });
      const res = await linkTokenPost(req);
      expect(res.status).toBe(404);
    });

    it("returns errorResponse when linkTokenCreate throws", async () => {
      mockLinkTokenCreate.mockRejectedValue(new Error("plaid down"));
      const req = new NextRequest("http://localhost/api/plaid/link-token", { method: "POST" });
      const res = await linkTokenPost(req);
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/plaid/reconnect", () => {
    it("returns response when requireOwnedItem fails", async () => {
      mockRequireOwnedItem.mockResolvedValue({
        ok: false,
        response: new NextResponse("unauthorized", { status: 401 }),
      });
      const res = await reconnectPost({} as NextRequest);
      expect(res.status).toBe(401);
    });

    it("returns 400 when itemGet cannot confirm the re-link", async () => {
      mockItemGet.mockRejectedValue(new Error("gone"));
      const req = new NextRequest("http://localhost/api/plaid/reconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await reconnectPost(req);
      expect(res.status).toBe(400);
      expect(mockLogError).toHaveBeenCalledWith("plaid.reconnect.itemGet", expect.any(Error));
    });

    it("reconnects with branding present", async () => {
      mockItemGet.mockResolvedValue({ data: { item: {} } });
      const req = new NextRequest("http://localhost/api/plaid/reconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await reconnectPost(req);
      expect(res.status).toBe(200);
      expect(mockSetItemStatus).toHaveBeenCalledWith("item-1", "active", null);
      expect(mockUpdateItemBranding).toHaveBeenCalled();
      expect(mockSyncItemTransactions).toHaveBeenCalled();
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "plaid_reconnect" }),
      );
    });

    it("skips branding update when branding is null", async () => {
      mockItemGet.mockResolvedValue({ data: { item: {} } });
      mockFetchInstitutionBranding.mockResolvedValue(null);
      const req = new NextRequest("http://localhost/api/plaid/reconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await reconnectPost(req);
      expect(res.status).toBe(200);
      expect(mockUpdateItemBranding).not.toHaveBeenCalled();
    });

    it("logs when branding update throws", async () => {
      mockItemGet.mockResolvedValue({ data: { item: {} } });
      mockUpdateItemBranding.mockRejectedValue(new Error("branding down"));
      const req = new NextRequest("http://localhost/api/plaid/reconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await reconnectPost(req);
      expect(res.status).toBe(200);
      expect(mockLogError).toHaveBeenCalledWith("plaid.reconnect.branding", expect.any(Error));
    });

    it("logs when sync throws", async () => {
      mockItemGet.mockResolvedValue({ data: { item: {} } });
      mockSyncItemTransactions.mockRejectedValue(new Error("sync down"));
      const req = new NextRequest("http://localhost/api/plaid/reconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await reconnectPost(req);
      expect(res.status).toBe(200);
      expect(mockLogError).toHaveBeenCalledWith("plaid.reconnect.sync", expect.any(Error));
    });

    it("skips branding when the item has no institution_id", async () => {
      mockRequireOwnedItem.mockResolvedValue({
        ok: true,
        user: { id: "user-1" },
        item: { id: "item-1", institution_id: null, institution_name: "X" },
      });
      mockItemGet.mockResolvedValue({ data: { item: {} } });
      const req = new NextRequest("http://localhost/api/plaid/reconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await reconnectPost(req);
      expect(res.status).toBe(200);
      expect(mockFetchInstitutionBranding).not.toHaveBeenCalled();
    });

    it("returns errorResponse when a fatal error occurs", async () => {
      mockRequireOwnedItem.mockRejectedValue(new Error("fatal"));
      const req = new NextRequest("http://localhost/api/plaid/reconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await reconnectPost(req);
      expect(res.status).toBe(500);
    });
  });
});
