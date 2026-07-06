import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { encryptSecret } from "@/lib/crypto";

// Mocking Route Handler dependencies
const mockSyncAllForUser = vi.fn();
const mockRefreshRecurringForUser = vi.fn();
const mockSyncItemTransactions = vi.fn();

vi.mock("@/lib/sync", () => ({
  syncAllForUser: (...args: unknown[]) => mockSyncAllForUser(...args),
  syncItemTransactions: (...args: unknown[]) => mockSyncItemTransactions(...args),
}));

vi.mock("@/lib/recurring", () => ({
  refreshRecurringForUser: (...args: unknown[]) => mockRefreshRecurringForUser(...args),
}));

const mockLinkTokenCreate = vi.fn();
const mockItemPublicTokenExchange = vi.fn();
const mockItemGet = vi.fn();
const mockInstitutionsGetById = vi.fn();
const mockItemRemove = vi.fn();
const mockAccountsGet = vi.fn();

vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    linkTokenCreate: mockLinkTokenCreate,
    itemPublicTokenExchange: mockItemPublicTokenExchange,
    itemGet: mockItemGet,
    institutionsGetById: mockInstitutionsGetById,
    itemRemove: mockItemRemove,
    accountsGet: mockAccountsGet,
  }),
}));

// Mock requireUser and requireAdmin
let activeUser: unknown = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeSupabaseClient: any = null;
let activeAdminUser: unknown = null;

vi.mock("@/lib/http", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/http")>();
  return {
    ...original,
    requireUser: async () => {
      if (!activeUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return { user: activeUser, supabase: activeSupabaseClient };
    },
    requireAdmin: async () => {
      if (!activeUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!activeAdminUser) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return { user: activeUser, supabase: activeSupabaseClient };
    },
  };
});

// Import API routes
import { GET as cronSyncGet } from "@/app/api/cron/sync/route";
import { GET as exportCsvGet } from "@/app/api/export/csv/route";
import { DELETE as accountDelete } from "@/app/api/account/route";
import { POST as plaidDisconnectPost } from "@/app/api/plaid/disconnect/route";
import { POST as plaidLinkTokenPost } from "@/app/api/plaid/link-token/route";
import { POST as plaidSyncPost } from "@/app/api/plaid/sync/route";
import { POST as plaidExchangePost } from "@/app/api/plaid/exchange/route";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);
const suite = run ? describe : describe.skip;

suite("API routes integration", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  let tempUserId = "";
  let tempUserClient: ReturnType<typeof createClient>;
  let tempUserObj: unknown;

  beforeAll(async () => {
    // Create temporary user
    const { data, error } = await admin.auth.admin.createUser({
      email: `api-t-${stamp}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (error) throw error;
    tempUserId = data.user.id;
    tempUserObj = data.user;

    // Login to get user-scoped Supabase client
    tempUserClient = createClient(url!, publishable!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await tempUserClient.auth.signInWithPassword({
      email: `api-t-${stamp}@example.com`,
      password: "Password123!",
    });
    if (signInError) throw signInError;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (tempUserId) {
      await admin.auth.admin.deleteUser(tempUserId);
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    activeUser = null;
    activeSupabaseClient = null;
    activeAdminUser = null;
  });

  describe("Authentication Guard", () => {
    it("returns 401 for unauthenticated requests", async () => {
      const req = new NextRequest("http://localhost/api/plaid/sync", { method: "POST" });
      const resp = await plaidSyncPost(req);
      expect(resp.status).toBe(401);
      const json = await resp.json();
      expect(json.error).toBe("Unauthorized");
    });
  });

  describe("/api/cron/sync", () => {
    it("returns 401 with missing or wrong CRON_SECRET authorization", async () => {
      const req = new NextRequest("http://localhost/api/cron/sync", {
        headers: { authorization: "Bearer wrong-secret" },
      });
      const resp = await cronSyncGet(req);
      expect(resp.status).toBe(401);
    });

    it("runs successfully and returns synced user count with correct secret", async () => {
      mockSyncAllForUser.mockResolvedValue({ added: 1, modified: 0, removed: 0 });
      mockRefreshRecurringForUser.mockResolvedValue(0);

      // Seed an active item so the cron has a user to sync
      const enc = encryptSecret("dummy-cron-token");
      const { data: item } = await admin.from("plaid_items").insert({
        user_id: tempUserId,
        plaid_item_id: `cron-item-${stamp}`,
        access_token_ciphertext: enc.ciphertext,
        access_token_iv: enc.iv,
        access_token_tag: enc.tag,
        status: "active",
      }).select("id").single();

      const req = new NextRequest("http://localhost/api/cron/sync", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      const resp = await cronSyncGet(req);
      expect(resp.status).toBe(200);

      const json = await resp.json();
      expect(json.ok).toBe(true);
      expect(json.users).toBeGreaterThanOrEqual(1);

      // Clean up item
      await admin.from("plaid_items").delete().eq("id", item!.id);
    });
  });

  describe("/api/export/csv", () => {
    it("returns 403 if exporting is disabled in profile settings", async () => {
      activeUser = tempUserObj;
      activeSupabaseClient = tempUserClient;

      // Update profile setting to false
      await admin
        .from("profiles")
        .update({ ai_export_enabled: false })
        .eq("id", tempUserId);

      const req = new NextRequest("http://localhost/api/export/csv");
      const resp = await exportCsvGet(req);
      expect(resp.status).toBe(403);
      const json = await resp.json();
      expect(json.error).toContain("disabled in your settings");
    });

    it("returns 200 and CSV content if export is enabled", async () => {
      activeUser = tempUserObj;
      activeSupabaseClient = tempUserClient;

      // Update profile setting to true
      await admin
        .from("profiles")
        .update({ ai_export_enabled: true })
        .eq("id", tempUserId);

      // Seed a transaction
      const enc = encryptSecret("dummy-csv-token");
      const { data: item } = await admin
        .from("plaid_items")
        .insert({
          user_id: tempUserId,
          plaid_item_id: `csv-item-${stamp}`,
          access_token_ciphertext: enc.ciphertext,
          access_token_iv: enc.iv,
          access_token_tag: enc.tag,
        })
        .select("id")
        .single();

      const { data: account } = await admin
        .from("accounts")
        .insert({
          user_id: tempUserId,
          plaid_item_id: item!.id,
          plaid_account_id: `csv-acct-${stamp}`,
          name: "Checking",
        })
        .select("id")
        .single();

      await admin.from("transactions").insert({
        user_id: tempUserId,
        account_id: account!.id,
        plaid_transaction_id: `csv-txn-${stamp}`,
        amount: 25.5,
        date: "2026-06-01",
        merchant_name: "Whole Foods",
        pfc_primary: "FOOD_AND_DRINK",
      });

      const req = new NextRequest("http://localhost/api/export/csv");
      const resp = await exportCsvGet(req);
      expect(resp.status).toBe(200);
      expect(resp.headers.get("Content-Type")).toContain("text/csv");

      const body = await resp.text();
      expect(body).toContain("date,merchant,amount,category");
      expect(body).toContain("Whole Foods");
      expect(body).toContain("25.5");

      // Verify that audit log and export records were created
      const { data: exports } = await admin
        .from("data_exports")
        .select("id")
        .eq("user_id", tempUserId);
      expect(exports).toHaveLength(1);

      // Clean up item & account (cascades transactions)
      await admin.from("plaid_items").delete().eq("id", item!.id);
    });
  });

  describe("/api/plaid/link-token", () => {
    it("returns the created link token", async () => {
      activeUser = tempUserObj;
      activeSupabaseClient = tempUserClient;

      mockLinkTokenCreate.mockResolvedValue({
        data: { link_token: "link-sandbox-12345" },
      });

      const resp = await plaidLinkTokenPost();
      expect(resp.status).toBe(200);

      const json = await resp.json();
      expect(json.link_token).toBe("link-sandbox-12345");
      expect(mockLinkTokenCreate).toHaveBeenCalledWith({
        user: { client_user_id: tempUserId },
        client_name: "FundFlow",
        products: ["transactions"],
        country_codes: ["US"],
        language: "en",
      });
    });
  });

  describe("/api/plaid/sync", () => {
    it("successfully syncs transactions on demand", async () => {
      activeUser = tempUserObj;
      activeSupabaseClient = tempUserClient;

      mockSyncAllForUser.mockResolvedValue({ added: 3, modified: 1, removed: 0 });
      mockRefreshRecurringForUser.mockResolvedValue(2);

      const req = new NextRequest("http://localhost/api/plaid/sync", { method: "POST" });
      const resp = await plaidSyncPost(req);
      expect(resp.status).toBe(200);

      const json = await resp.json();
      expect(json.ok).toBe(true);
      expect(json.added).toBe(3);
      expect(json.recurring_streams).toBe(2);
    });
  });

  describe("/api/plaid/disconnect", () => {
    it("fails with 400 when item_id is missing", async () => {
      activeUser = tempUserObj;
      activeSupabaseClient = tempUserClient;

      const req = new NextRequest("http://localhost/api/plaid/disconnect", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const resp = await plaidDisconnectPost(req);
      expect(resp.status).toBe(400);
    });

    it("fails with 404 if item does not exist", async () => {
      activeUser = tempUserObj;
      activeSupabaseClient = tempUserClient;

      const req = new NextRequest("http://localhost/api/plaid/disconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: "00000000-0000-0000-0000-000000000000" }),
      });
      const resp = await plaidDisconnectPost(req);
      expect(resp.status).toBe(404);
    });

    it("disconnects the item and deletes local records", async () => {
      activeUser = tempUserObj;
      activeSupabaseClient = tempUserClient;

      // Seed item
      const enc = encryptSecret("dummy-disconnect-token");
      const { data: item } = await admin
        .from("plaid_items")
        .insert({
          user_id: tempUserId,
          plaid_item_id: `disc-item-${stamp}`,
          institution_name: "Mock Bank",
          access_token_ciphertext: enc.ciphertext,
          access_token_iv: enc.iv,
          access_token_tag: enc.tag,
        })
        .select("id")
        .single();

      mockItemRemove.mockResolvedValue({ data: {} });

      const req = new NextRequest("http://localhost/api/plaid/disconnect", {
        method: "POST",
        body: JSON.stringify({ item_id: item!.id }),
      });
      const resp = await plaidDisconnectPost(req);
      expect(resp.status).toBe(200);

      // Verify it was deleted from DB
      const { data: deletedItem } = await admin
        .from("plaid_items")
        .select("id")
        .eq("id", item!.id)
        .maybeSingle();

      expect(deletedItem).toBeNull();
    });
  });

  describe("/api/plaid/exchange", () => {
    it("fails with 400 when public_token is missing", async () => {
      activeUser = tempUserObj;
      activeSupabaseClient = tempUserClient;

      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const resp = await plaidExchangePost(req);
      expect(resp.status).toBe(400);
    });

    it("successfully exchanges public token and stores item + initial sync", async () => {
      activeUser = tempUserObj;
      activeSupabaseClient = tempUserClient;

      mockItemPublicTokenExchange.mockResolvedValue({
        data: { access_token: `access-ex-${stamp}`, item_id: `plaid-item-ex-${stamp}` },
      });
      mockItemGet.mockResolvedValue({
        data: { item: { institution_id: `ins-ex-${stamp}` } },
      });
      mockInstitutionsGetById.mockResolvedValue({
        data: { institution: { name: "Exchange Bank" } },
      });
      mockAccountsGet.mockResolvedValue({
        data: { accounts: [] },
      });
      mockSyncItemTransactions.mockResolvedValue({ added: 0, modified: 0, removed: 0 });

      const req = new NextRequest("http://localhost/api/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({ public_token: "public-sandbox-abc" }),
      });
      const resp = await plaidExchangePost(req);
      expect(resp.status).toBe(200);

      const json = await resp.json();
      expect(json.ok).toBe(true);
      expect(json.institution_name).toBe("Exchange Bank");

      // Verify item exists in database
      const { data: item } = await admin
        .from("plaid_items")
        .select("id, status")
        .eq("plaid_item_id", `plaid-item-ex-${stamp}`)
        .single();

      expect(item).toBeTruthy();
      expect(item!.status).toBe("active");

      // Clean up item
      await admin.from("plaid_items").delete().eq("id", item!.id);
    });
  });

  describe("/api/account DELETE", () => {
    it("deletes user account and cascades DB deletion", async () => {
      // We will create a brand new temporary user just for deletion test
      const { data: delUser } = await admin.auth.admin.createUser({
        email: `api-del-${stamp}@example.com`,
        password: "Password123!",
        email_confirm: true,
      });

      const delUserClient = createClient(url!, publishable!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await delUserClient.auth.signInWithPassword({
        email: `api-del-${stamp}@example.com`,
        password: "Password123!",
      });

      const enc = encryptSecret("dummy-del-token");
      await admin
        .from("plaid_items")
        .insert({
          user_id: delUser.user!.id,
          plaid_item_id: `del-item-${stamp}`,
          access_token_ciphertext: enc.ciphertext,
          access_token_iv: enc.iv,
          access_token_tag: enc.tag,
        });

      mockItemRemove.mockResolvedValue({ data: {} });

      activeUser = delUser.user!;
      activeSupabaseClient = delUserClient;

      const req = new NextRequest("http://localhost/api/account", { method: "DELETE" });
      const resp = await accountDelete(req);
      expect(resp.status).toBe(200);

      // Verify user deleted in Supabase auth
      const { data: userCheck } = await admin.auth.admin.getUserById(delUser.user!.id).catch(() => ({ data: { user: null } }));
      expect(userCheck.user).toBeNull();
    });
  });
});
