import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (msg: unknown) =>
    NextResponse.json({ error: String(msg) }, { status: 400 }),
  errorResponse: (_context: unknown, error: unknown) =>
    NextResponse.json({ error: (error as Error).message }, { status: 500 }),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

const mockItemRemove = vi.fn<(...args: unknown[]) => unknown>();
const mockItemPublicTokenExchange = vi.fn<(...args: unknown[]) => unknown>();
const mockItemGet = vi.fn<(...args: unknown[]) => unknown>();
const mockInstitutionsGetById = vi.fn<(...args: unknown[]) => unknown>();
const mockAccountsGet = vi.fn<(...args: unknown[]) => unknown>();
const mockLinkTokenCreate = vi.fn<(...args: unknown[]) => unknown>();
const mockLinkTokenGet = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    itemRemove: (...args: unknown[]) => mockItemRemove(...args),
    itemPublicTokenExchange: (...args: unknown[]) => mockItemPublicTokenExchange(...args),
    itemGet: (...args: unknown[]) => mockItemGet(...args),
    institutionsGetById: (...args: unknown[]) => mockInstitutionsGetById(...args),
    accountsGet: (...args: unknown[]) => mockAccountsGet(...args),
    linkTokenCreate: (...args: unknown[]) => mockLinkTokenCreate(...args),
    linkTokenGet: (...args: unknown[]) => mockLinkTokenGet(...args),
  }),
}));

const mockListActiveItems = vi.fn<(...args: unknown[]) => unknown>();
const mockDecryptItemToken = vi.fn<(...args: unknown[]) => unknown>();
const mockGetItem = vi.fn<(...args: unknown[]) => unknown>();
const mockStoreItem = vi.fn<(...args: unknown[]) => unknown>();
const mockUpsertAccounts = vi.fn<(...args: unknown[]) => unknown>();
const mockStoreLinkToken = vi.fn<(...args: unknown[]) => unknown>();
const mockConsumeLinkToken = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("@/lib/plaid-service", () => ({
  listActiveItems: (...args: unknown[]) => mockListActiveItems(...args),
  decryptItemToken: (...args: unknown[]) => mockDecryptItemToken(...args),
  getItem: (...args: unknown[]) => mockGetItem(...args),
  storeItem: (...args: unknown[]) => mockStoreItem(...args),
  upsertAccounts: (...args: unknown[]) => mockUpsertAccounts(...args),
  storeLinkToken: (...args: unknown[]) => mockStoreLinkToken(...args),
  consumeLinkToken: (...args: unknown[]) => mockConsumeLinkToken(...args),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockSyncItemTransactions = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/sync", () => ({
  syncItemTransactions: (...args: unknown[]) => mockSyncItemTransactions(...args),
}));

const mockLogError = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockFetchInstitutionBranding = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid-institution", () => ({
  fetchInstitutionBranding: (...args: unknown[]) => mockFetchInstitutionBranding(...args),
}));

import { DELETE as accountDelete } from "@/app/api/account/route";
import { POST as disconnectPost } from "@/app/api/plaid/disconnect/route";
import { POST as exchangePost } from "@/app/api/plaid/exchange/route";
import { POST as linkTokenPost } from "@/app/api/plaid/link-token/route";

const stepUpSupabase = {
  auth: {
    mfa: {
      listFactors: vi.fn().mockResolvedValue({ data: { totp: [], phone: [] } }),
    },
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
  },
} as unknown as never;

const USER = {
  user: { id: "user-1", email: "user@example.com" },
  supabase: stepUpSupabase,
};

describe("Direct Plaid & Account Routes Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceClient = clientStub();
    mockRequireUser.mockResolvedValue(USER);
    mockDecryptItemToken.mockReturnValue("decrypted-token");
    mockCheckRateLimit.mockResolvedValue(true);
    mockLinkTokenGet.mockResolvedValue({ data: { link_sessions: [] } });
    mockConsumeLinkToken.mockResolvedValue(true);
  });

  describe("DELETE /api/account", () => {
    it("returns auth error if unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
      const req = new NextRequest("http://localhost/api/account", { method: "DELETE" });
      const res = await accountDelete(req);
      expect(res.status).toBe(401);
    });

    it("deletes user account and active items", async () => {
      mockListActiveItems.mockResolvedValue([{ id: "item-1" }]);
      mockItemRemove.mockResolvedValue({ data: {} });
      serviceClient = {
        ...clientStub(),
        auth: {
          admin: {
            deleteUser: vi.fn().mockResolvedValue({ error: null }),
          },
        },
      } as unknown as typeof serviceClient;

      const req = new NextRequest("http://localhost/api/account", {
        method: "DELETE",
        body: JSON.stringify({ method: "password", code: "Password123!" }),
      });
      const res = await accountDelete(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ ok: true });
      expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "account_delete" }));
    });

    it("continues deletion even if itemRemove throws", async () => {
      mockListActiveItems.mockResolvedValue([{ id: "item-1" }]);
      mockItemRemove.mockRejectedValue(new Error("Plaid error"));
      serviceClient = {
        ...clientStub(),
        auth: {
          admin: {
            deleteUser: vi.fn().mockResolvedValue({ error: null }),
          },
        },
      } as unknown as typeof serviceClient;

      const req = new NextRequest("http://localhost/api/account", {
        method: "DELETE",
        body: JSON.stringify({ method: "password", code: "Password123!" }),
      });
      const res = await accountDelete(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ ok: true });
      expect(mockLogError).toHaveBeenCalledWith("account.delete.itemRemove", expect.any(Error));
    });

    it("returns errorResponse if auth deleteUser fails", async () => {
      mockListActiveItems.mockResolvedValue([]);
      serviceClient = {
        ...clientStub(),
        auth: {
          admin: {
            deleteUser: vi.fn().mockResolvedValue({ error: new Error("DB Error") }),
          },
        },
      } as unknown as typeof serviceClient;

      const req = new NextRequest("http://localhost/api/account", {
        method: "DELETE",
        body: JSON.stringify({ method: "password", code: "Password123!" }),
      });
      const res = await accountDelete(req);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("DB Error");
    });
  });

  describe("POST /api/plaid/disconnect", () => {
    it("returns auth error if unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
      const req = new NextRequest("http://localhost/api/plaid/disconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await disconnectPost(req);
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid JSON body or missing item_id", async () => {
      const req1 = new NextRequest("http://localhost/api/plaid/disconnect", { method: "POST", body: "invalid json" });
      const res1 = await disconnectPost(req1);
      expect(res1.status).toBe(400);

      const req2 = new NextRequest("http://localhost/api/plaid/disconnect", { method: "POST", body: JSON.stringify({}) });
      const res2 = await disconnectPost(req2);
      expect(res2.status).toBe(400);
    });

    it("returns 404 if item not found", async () => {
      mockGetItem.mockResolvedValue(null);
      const req = new NextRequest("http://localhost/api/plaid/disconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "non-existent" }),
      });
      const res = await disconnectPost(req);
      expect(res.status).toBe(404);
    });

    it("disconnects bank item successfully", async () => {
      mockGetItem.mockResolvedValue({ id: "item-1", institution_name: "Chase" });
      mockItemRemove.mockResolvedValue({ data: {} });
      serviceClient = clientStub({ plaid_items: { error: null } });

      const req = new NextRequest("http://localhost/api/plaid/disconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await disconnectPost(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ ok: true });
    });
  });

  describe("POST /api/plaid/exchange", () => {
    it("returns 429 when rate limited", async () => {
      mockCheckRateLimit.mockResolvedValue(false);
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "tok-123" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(429);
    });

    it("returns 400 for invalid JSON or missing public_token", async () => {
      const req1 = new NextRequest("http://localhost/api/plaid/exchange", { method: "POST", body: "invalid json" });
      const res1 = await exchangePost(req1);
      expect(res1.status).toBe(400);

      const req2 = new NextRequest("http://localhost/api/plaid/exchange", { method: "POST", body: JSON.stringify({}) });
      const res2 = await exchangePost(req2);
      expect(res2.status).toBe(400);
    });

    it("rejects an exchange when the link token is missing or unconsumable", async () => {
      mockConsumeLinkToken.mockResolvedValue(false);
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "public-tok-123", link_token: "link-123" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(400);
      expect(mockItemPublicTokenExchange).not.toHaveBeenCalled();
    });

    it("exchanges token, stores item, and completes initial sync", async () => {
      mockItemPublicTokenExchange.mockResolvedValue({
        data: { access_token: "access-123", item_id: "plaid-item-1" },
      });
      mockItemGet.mockResolvedValue({ data: { item: { institution_id: "inst-1" } } });
      mockFetchInstitutionBranding.mockResolvedValue({
        institutionId: "inst-1",
        name: "Bank of America",
        logo: "logo-base64",
        brandColor: "#112233",
      });
      mockStoreItem.mockResolvedValue("item-db-1");
      mockAccountsGet.mockResolvedValue({ data: { accounts: [] } });
      mockUpsertAccounts.mockResolvedValue(undefined);
      mockGetItem.mockResolvedValue({ id: "item-db-1" });
      mockSyncItemTransactions.mockResolvedValue(undefined);

      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "public-tok-123", link_token: "link-123" }),
      });
      const res = await exchangePost(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ ok: true, institution_name: "Bank of America" });
      expect(mockStoreItem).toHaveBeenCalledWith(expect.objectContaining({
        institutionLogo: "logo-base64",
        institutionBrandColor: "#112233",
      }));
    });

    it("rejects a public token minted by a different link token", async () => {
      mockLinkTokenGet.mockResolvedValue({
        data: {
          link_sessions: [{ on_success: { public_token: "other-public-token" } }],
        },
      });
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "public-tok-123", link_token: "link-123" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(400);
      expect(mockItemPublicTokenExchange).not.toHaveBeenCalled();
    });

    it("logs error and continues when institution get or initial sync fails", async () => {
      mockItemPublicTokenExchange.mockResolvedValue({
        data: { access_token: "access-123", item_id: "plaid-item-1" },
      });
      mockItemGet.mockRejectedValue(new Error("Plaid itemGet failed"));
      mockStoreItem.mockResolvedValue("item-db-1");
      mockAccountsGet.mockResolvedValue({ data: { accounts: [] } });
      mockUpsertAccounts.mockResolvedValue(undefined);
      mockGetItem.mockResolvedValue({ id: "item-db-1" });
      mockSyncItemTransactions.mockRejectedValue(new Error("Sync failed"));

      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "public-tok-123", link_token: "link-123" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(200);
      expect(mockLogError).toHaveBeenCalledWith("plaid.exchange.institution", expect.any(Error));
      expect(mockLogError).toHaveBeenCalledWith("plaid.exchange.initial-sync", expect.any(Error));
    });

    it("returns 500 when public token exchange throws", async () => {
      mockItemPublicTokenExchange.mockRejectedValue(new Error("Exchange failed"));
      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "public-tok-123", link_token: "link-123" }),
      });
      const res = await exchangePost(req);
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/plaid/link-token", () => {
    it("creates a link token in normal mode", async () => {
      mockLinkTokenCreate.mockResolvedValue({ data: { link_token: "link-sandbox-123" } });
      const req = new NextRequest("http://localhost/api/plaid/link-token", { method: "POST" });
      const res = await linkTokenPost(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ link_token: "link-sandbox-123" });
      // The link token is persisted (hashed, user-bound) for exchange binding.
      expect(mockStoreLinkToken).toHaveBeenCalledWith("user-1", "link-sandbox-123", null);
      // Investments is optional, not required: existing Transactions-only
      // links keep working, and an institution without Investments support
      // still shows up in Link instead of being filtered out.
      expect(mockLinkTokenCreate).toHaveBeenCalledWith(
        expect.objectContaining({ optional_products: ["investments"] }),
      );
    });

    it("creates a link token in update mode for existing item", async () => {
      mockGetItem.mockResolvedValue({ id: "item-1" });
      mockLinkTokenCreate.mockResolvedValue({ data: { link_token: "link-update-123" } });

      const req = new NextRequest("http://localhost/api/plaid/link-token", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await linkTokenPost(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ link_token: "link-update-123" });
      // Update mode reconnects an existing Item; adding a new product is a
      // separate, deliberate action, not a side effect of reconnecting.
      const updateModeCall = mockLinkTokenCreate.mock.calls.at(-1)![0] as {
        optional_products?: unknown;
        products?: unknown;
      };
      expect(updateModeCall.optional_products).toBeUndefined();
      expect(updateModeCall.products).toBeUndefined();
    });

    it("returns 404 in update mode if item not found", async () => {
      mockGetItem.mockResolvedValue(null);

      const req = new NextRequest("http://localhost/api/plaid/link-token", {
        method: "POST",
        body: JSON.stringify({ item_id: "non-existent" }),
      });
      const res = await linkTokenPost(req);
      expect(res.status).toBe(404);
    });
  });
});
