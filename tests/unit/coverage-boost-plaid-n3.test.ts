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

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

const mockBuildDemoDataset = vi.fn<(...args: unknown[]) => unknown>();
const mockBuildDemoAccountSnapshots = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/demo-data", () => ({
  buildDemoDataset: (...args: unknown[]) => mockBuildDemoDataset(...args),
  buildDemoAccountSnapshots: (...args: unknown[]) => mockBuildDemoAccountSnapshots(...args),
}));

const mockInvalidateDashboardCache = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/dashboard-cache", () => ({
  invalidateDashboardCache: (...args: unknown[]) => mockInvalidateDashboardCache(...args),
}));

const mockItemRemove = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({ itemRemove: (...args: unknown[]) => mockItemRemove(...args) }),
}));

const mockDecryptItemToken = vi.fn<(...args: unknown[]) => unknown>(
  () => "decrypted-token",
);
vi.mock("@/lib/plaid-service", () => ({
  decryptItemToken: (...args: unknown[]) => mockDecryptItemToken(...args),
}));

const mockRequireOwnedItem = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid-item-route", () => ({
  requireOwnedItem: (...args: unknown[]) => mockRequireOwnedItem(...args),
}));

const mockLogError = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockSyncAllForUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/sync", () => ({
  syncAllForUser: (...args: unknown[]) => mockSyncAllForUser(...args),
}));

const mockRefreshRecurringForUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/recurring", () => ({
  refreshRecurringForUser: (...args: unknown[]) => mockRefreshRecurringForUser(...args),
}));

const mockTryWriteDailyAccountSnapshots = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/account-history", () => ({
  tryWriteDailyAccountSnapshots: (...args: unknown[]) => mockTryWriteDailyAccountSnapshots(...args),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(
  () => Promise.resolve(true),
);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

let serviceClient: unknown = {};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

import { POST as demoPost, DELETE as demoDelete } from "@/app/api/demo/route";
import { POST as disconnectPost } from "@/app/api/plaid/disconnect/route";
import { POST as sharePost } from "@/app/api/plaid/share/route";
import { POST as syncPost } from "@/app/api/plaid/sync/route";

const USER = { user: { id: "user-1", email: "u@e.com" } };

function demoService(opts: {
  existingItems?: unknown;
  deleteError?: unknown;
  itemRow?: unknown;
  itemError?: unknown;
  accountRows?: unknown;
  accountError?: unknown;
  snapshotError?: unknown;
  txnError?: unknown;
} = {}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "plaid_items") {
        const main = {
          then: (r: (v: unknown) => unknown) => r({ error: opts.deleteError }),
          select: () => ({ then: (r: (v: unknown) => unknown) => r({ data: opts.existingItems }) }),
          delete: () => main,
          eq: () => main,
          like: () => main,
          insert: () => {
            const insertMain = { then: (r: (v: unknown) => unknown) => r({ data: opts.itemRow, error: opts.itemError }) };
            return { select: () => ({ single: () => insertMain }) };
          },
        };
        return main;
      }
      if (table === "accounts") {
        return { insert: () => ({ select: () => ({ then: (r: (v: unknown) => unknown) => r({ data: opts.accountRows, error: opts.accountError }) }) }) };
      }
      if (table === "account_balance_snapshots") {
        return { upsert: () => ({ then: (r: (v: unknown) => unknown) => r({ error: opts.snapshotError }) }) };
      }
      if (table === "transactions") {
        return { insert: () => ({ then: (r: (v: unknown) => unknown) => r({ error: opts.txnError }) }) };
      }
      return { then: (r: (v: unknown) => unknown) => r({ data: null }) };
    }),
  };
}

function seedDemoDataset() {
  mockBuildDemoDataset.mockReturnValue({
    item: { plaid_item_id: "demo-1", institution_name: "Demo", status: "disconnected" },
    accounts: [{ name: "Checking" }],
    transactions: [
      { accountIndex: 0, plaid_transaction_id: "p1", date: "2026-01-01", amount: 10, name: "X", merchant_name: "X", pfc_primary: "COFFEE", pending: false },
    ],
  });
  mockBuildDemoAccountSnapshots.mockReturnValue([{ id: "snap-1" }]);
}

describe("coverage-boost-plaid-n3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(USER);
    mockCheckRateLimit.mockResolvedValue(true);
    mockRequireOwnedItem.mockResolvedValue({
      ok: true,
      user: { id: "user-1" },
      item: { id: "item-1", institution_name: "Chase" },
    });
    mockItemRemove.mockResolvedValue({ data: {} });
    seedDemoDataset();
  });

  function demoUser(existingItems: unknown) {
    mockRequireUser.mockResolvedValue({
      user: { id: "user-1" },
      supabase: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            then: (r: (v: unknown) => unknown) => r({ data: existingItems }),
          }),
        }),
      },
    });
  }

  describe("POST /api/demo", () => {
    it("loads demo data successfully", async () => {
      demoUser([{ plaid_item_id: "demo-1" }]);
      serviceClient = demoService({
        itemRow: { id: "item-row-1" },
        accountRows: [{ id: "acc-1" }],
      });
      const res = await demoPost();
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, transactions: 1 });
      expect(mockInvalidateDashboardCache).toHaveBeenCalledWith("user-1");
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "demo_data_loaded" }),
      );
    });

    it("refuses to load when a real bank is connected", async () => {
      demoUser([{ plaid_item_id: "real-1" }]);
      serviceClient = demoService();
      const res = await demoPost();
      expect(res.status).toBe(409);
    });

    it("handles a null accountRows result", async () => {
      demoUser([]);
      serviceClient = demoService({
        itemRow: { id: "item-row-1" },
        accountRows: null,
      });
      const res = await demoPost();
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, transactions: 1 });
    });

    it("returns errorResponse when snapshot upsert fails", async () => {
      demoUser([]);
      serviceClient = demoService({
        itemRow: { id: "item-row-1" },
        accountRows: [{ id: "acc-1" }],
        snapshotError: { message: "snap down" },
      });
      const res = await demoPost();
      expect(res.status).toBe(500);
    });

    it("returns errorResponse when transaction insert fails", async () => {
      demoUser([]);
      serviceClient = demoService({
        itemRow: { id: "item-row-1" },
        accountRows: [{ id: "acc-1" }],
        txnError: { message: "txn down" },
      });
      const res = await demoPost();
      expect(res.status).toBe(500);
    });

    it("returns auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await demoPost();
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /api/demo", () => {
    it("clears demo data successfully", async () => {
      serviceClient = demoService();
      const res = await demoDelete();
      expect(res.status).toBe(200);
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "demo_data_cleared" }),
      );
    });

    it("returns errorResponse when the delete fails", async () => {
      serviceClient = demoService({ deleteError: { message: "down" } });
      const res = await demoDelete();
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/plaid/disconnect", () => {
    const ownedClient = (deleteError: unknown) => {
      const chain = {
        then: (r: (v: unknown) => unknown) => r({ error: deleteError }),
        delete: () => chain,
        eq: () => chain,
      };
      return { from: vi.fn().mockReturnValue(chain) };
    };

    it("returns response when requireOwnedItem fails", async () => {
      mockRequireOwnedItem.mockResolvedValue({
        ok: false,
        response: new NextResponse("unauthorized", { status: 401 }),
      });
      const res = await disconnectPost({} as NextRequest);
      expect(res.status).toBe(401);
    });

    it("continues even when Plaid itemRemove throws", async () => {
      mockItemRemove.mockRejectedValue(new Error("plaid down"));
      serviceClient = ownedClient(null);
      const req = new NextRequest("http://localhost/api/plaid/disconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await disconnectPost(req);
      expect(res.status).toBe(200);
      expect(mockLogError).toHaveBeenCalledWith("plaid.disconnect.itemRemove", expect.any(Error));
    });

    it("disconnects successfully", async () => {
      serviceClient = ownedClient(null);
      const req = new NextRequest("http://localhost/api/plaid/disconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await disconnectPost(req);
      expect(res.status).toBe(200);
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "plaid_disconnect" }),
      );
    });

    it("returns errorResponse when the local delete fails", async () => {
      serviceClient = ownedClient({ message: "down" });
      const req = new NextRequest("http://localhost/api/plaid/disconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "item-1" }),
      });
      const res = await disconnectPost(req);
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/plaid/share", () => {
    const shareSupabase = (item: unknown, household: unknown) => ({
      from: vi.fn((table: string) => {
        if (table === "plaid_items") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue(item),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue(household),
        };
      }),
    });

    it("returns auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await sharePost({} as NextRequest);
      expect(res.status).toBe(401);
    });

    it("returns bad request when the body is invalid JSON", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: shareSupabase({ data: { id: "i1" } }, { data: { id: "h1" } }) });
      const req = new NextRequest("http://localhost/api/plaid/share", {
        method: "POST",
        body: "not json",
      });
      const res = await sharePost(req);
      expect(res.status).toBe(400);
    });

    it("returns bad request when itemId/share missing", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: shareSupabase({ data: { id: "i1" } }, { data: { id: "h1" } }) });
      const req = new NextRequest("http://localhost/api/plaid/share", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await sharePost(req);
      expect(res.status).toBe(400);
    });

    it("returns bad request when householdId missing for share", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: shareSupabase({ data: { id: "i1" } }, { data: { id: "h1" } }) });
      const req = new NextRequest("http://localhost/api/plaid/share", {
        method: "POST",
        body: JSON.stringify({ itemId: "i1", share: true }),
      });
      const res = await sharePost(req);
      expect(res.status).toBe(400);
    });

    it("returns 404 when the bank is not found", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: shareSupabase({ data: null }, { data: { id: "h1" } }) });
      const req = new NextRequest("http://localhost/api/plaid/share", {
        method: "POST",
        body: JSON.stringify({ itemId: "i1", share: false }),
      });
      const res = await sharePost(req);
      expect(res.status).toBe(404);
    });

    it("returns bad request when not a household member", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: shareSupabase({ data: { id: "i1" } }, { data: null }) });
      const req = new NextRequest("http://localhost/api/plaid/share", {
        method: "POST",
        body: JSON.stringify({ itemId: "i1", share: true, householdId: "h1" }),
      });
      const res = await sharePost(req);
      expect(res.status).toBe(400);
    });

    it("shares the connection successfully", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: shareSupabase({ data: { id: "i1" } }, { data: { id: "h1" } }) });
      serviceClient = { from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }) };
      const req = new NextRequest("http://localhost/api/plaid/share", {
        method: "POST",
        body: JSON.stringify({ itemId: "i1", share: true, householdId: "h1" }),
      });
      const res = await sharePost(req);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, householdId: "h1" });
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "household_share_changed" }),
      );
    });

    it("unshares the connection successfully", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: shareSupabase({ data: { id: "i1" } }, { data: null }) });
      serviceClient = { from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }) };
      const req = new NextRequest("http://localhost/api/plaid/share", {
        method: "POST",
        body: JSON.stringify({ itemId: "i1", share: false }),
      });
      const res = await sharePost(req);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, householdId: null });
    });

    it("returns errorResponse when the service update fails", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: shareSupabase({ data: { id: "i1" } }, { data: { id: "h1" } }) });
      (serviceClient as {
        from: () => {
          update: () => {
            eq: ((...a: unknown[]) => unknown) & { mockReturnValue: (v: unknown) => unknown };
          };
        };
      }).from().update().eq.mockReturnValue(Promise.resolve({ error: { message: "down" } }));
      const req = new NextRequest("http://localhost/api/plaid/share", {
        method: "POST",
        body: JSON.stringify({ itemId: "i1", share: true, householdId: "h1" }),
      });
      const res = await sharePost(req);
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/plaid/sync", () => {
    it("runs a manual refresh and audits", async () => {
      mockSyncAllForUser.mockResolvedValue({ synced: 2 });
      mockRefreshRecurringForUser.mockResolvedValue(3);
      const req = new NextRequest("http://localhost/api/plaid/sync", { method: "POST" });
      const res = await syncPost(req);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, synced: 2, recurring_streams: 3 });
      expect(mockTryWriteDailyAccountSnapshots).toHaveBeenCalledWith("user-1", "plaid.sync.snapshot");
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "data_refresh" }),
      );
    });

    it("runs an auto refresh without auditing recurring", async () => {
      mockSyncAllForUser.mockResolvedValue({ synced: 1 });
      const req = new NextRequest("http://localhost/api/plaid/sync", {
        method: "POST",
        body: JSON.stringify({ source: "auto" }),
      });
      const res = await syncPost(req);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, synced: 1, recurring_streams: null });
      expect(mockWriteAudit).not.toHaveBeenCalled();
      expect(mockRefreshRecurringForUser).not.toHaveBeenCalled();
      expect(mockCheckRateLimit).toHaveBeenCalledWith("autosync:user-1", 1, 1800);
    });

    it("skips when the auto window is closed", async () => {
      mockCheckRateLimit.mockResolvedValue(false);
      const req = new NextRequest("http://localhost/api/plaid/sync", {
        method: "POST",
        body: JSON.stringify({ source: "auto" }),
      });
      const res = await syncPost(req);
      await expect(res.json()).resolves.toEqual({ ok: true, skipped: true });
    });

    it("returns 429 when the manual limiter is closed", async () => {
      mockCheckRateLimit.mockResolvedValue(false);
      const req = new NextRequest("http://localhost/api/plaid/sync", { method: "POST" });
      const res = await syncPost(req);
      expect(res.status).toBe(429);
    });

    it("returns errorResponse when sync throws", async () => {
      mockSyncAllForUser.mockRejectedValue(new Error("sync down"));
      const req = new NextRequest("http://localhost/api/plaid/sync", { method: "POST" });
      const res = await syncPost(req);
      expect(res.status).toBe(500);
    });

    it("returns auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await syncPost({} as NextRequest);
      expect(res.status).toBe(401);
    });
  });
});
