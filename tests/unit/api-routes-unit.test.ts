import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn();
const mockVerifyApiToken = vi.fn();
const mockCheckRateLimit = vi.fn().mockResolvedValue(true);
const serviceDb = clientStub({
  accounts: { data: [] },
  data_exports: { data: [] },
  profiles: { data: { ai_export_enabled: true } },
});

vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>();
  return {
    ...actual,
    requireUser: () => mockRequireUser(),
  };
});

vi.mock("@/lib/api-tokens", () => ({
  API_TOKEN_PREFIX: "ff_pat_",
  verifyApiToken: (token: string | null) => mockVerifyApiToken(token),
  hashApiToken: (token: string) => "hashed_" + token,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (key: string, limit: number, window: number) =>
    mockCheckRateLimit(key, limit, window),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceDb,
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  getClientIp: () => "127.0.0.1",
}));

import { POST as aprPost } from "@/app/api/accounts/apr/route";
import { GET as exportJsonGet } from "@/app/api/export/json/route";
import { GET as exportTakeoutGet } from "@/app/api/export/takeout/route";
import { POST as tokenPost, DELETE as tokenDelete } from "@/app/api/tokens/route";
import {
  POST as tagsPost,
  PATCH as tagsPatch,
  DELETE as tagsDelete,
} from "@/app/api/settings/tags/route";
import { POST as annotatePost } from "@/app/api/transactions/annotate/route";

describe("API Route Handlers Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
  });

  describe("POST /api/accounts/apr", () => {
    it("returns 401 when requireUser returns response", async () => {
      mockRequireUser.mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const req = new NextRequest("http://localhost/api/accounts/apr", {
        method: "POST",
        body: JSON.stringify({ accountId: "acc-1", apr: 15.5 }),
      });
      const res = await aprPost(req);
      expect(res.status).toBe(401);
    });

    it("returns 400 when accountId is missing", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: clientStub(),
      });
      const req = new NextRequest("http://localhost/api/accounts/apr", {
        method: "POST",
        body: JSON.stringify({ apr: 15.5 }),
      });
      const res = await aprPost(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when apr is invalid", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: clientStub(),
      });
      const req = new NextRequest("http://localhost/api/accounts/apr", {
        method: "POST",
        body: JSON.stringify({ accountId: "acc-1", apr: 150 }),
      });
      const res = await aprPost(req);
      expect(res.status).toBe(400);
    });

    it("returns 404 when account is not found", async () => {
      const db = clientStub({
        accounts: { data: null },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/accounts/apr", {
        method: "POST",
        body: JSON.stringify({ accountId: "acc-1", apr: 15.5 }),
      });
      const res = await aprPost(req);
      expect(res.status).toBe(404);
    });

    it("updates APR successfully when owner matches", async () => {
      const db = clientStub({
        accounts: { data: { id: "acc-1" } },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/accounts/apr", {
        method: "POST",
        body: JSON.stringify({ accountId: "acc-1", apr: 15.5 }),
      });
      const res = await aprPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe("GET /api/export/json", () => {
    it("exports JSON when user is authed", async () => {
      const db = clientStub({
        profiles: { data: { ai_export_enabled: true } },
        transactions: {
          data: [
            {
              date: "2026-07-01",
              merchant_name: "Store",
              amount: 20,
              pfc_primary: "GENERAL",
            },
          ],
        },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/export/json");
      const res = await exportJsonGet(req);
      expect(res.status).toBe(200);
    });

    it("returns 403 when export is disabled", async () => {
      const db = clientStub({
        profiles: { data: { ai_export_enabled: false } },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/export/json");
      const res = await exportJsonGet(req);
      expect(res.status).toBe(403);
    });

    it("handles API token authentication", async () => {
      mockRequireUser.mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      mockVerifyApiToken.mockResolvedValue("token-user-1");

      const req = new NextRequest("http://localhost/api/export/json", {
        headers: { authorization: "Bearer secret-token" },
      });
      const res = await exportJsonGet(req);
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/export/takeout", () => {
    it("returns 401 when not authed", async () => {
      mockRequireUser.mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const res = await exportTakeoutGet();
      expect(res.status).toBe(401);
    });

    it("returns full data takeout for authed user", async () => {
      const db = clientStub({
        accounts: { data: [] },
        transactions: { data: [] },
        budgets: { data: [] },
        goals: { data: [] },
        merchant_rules: { data: [] },
        manual_accounts: { data: [] },
        account_balance_snapshots: { data: [] },
        alert_preferences: { data: [] },
        ai_settings: { data: [] },
        budget_periods: { data: [] },
        saved_reports: { data: [] },
        holdings: { data: [] },
        holding_snapshots: { data: [] },
        securities: { data: [] },
        investment_transactions: { data: [] },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const res = await exportTakeoutGet();
      expect(res.status).toBe(200);
    });
  });

  describe("/api/tokens", () => {
    it("POST creates token when rate limit passes", async () => {
      const db = clientStub({
        api_tokens: { data: { id: "tok-1", name: "My Token", created_at: "2026-07-01" } },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: "My Token" }),
      });
      const res = await tokenPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.token).toContain("ff_pat_");
    });

    it("POST returns 429 when rate limited", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: clientStub(),
      });
      mockCheckRateLimit.mockResolvedValue(false);
      const req = new NextRequest("http://localhost/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: "My Token" }),
      });
      const res = await tokenPost(req);
      expect(res.status).toBe(429);
    });

    it("POST returns 400 when name is missing", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: clientStub(),
      });
      const req = new NextRequest("http://localhost/api/tokens", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await tokenPost(req);
      expect(res.status).toBe(400);
    });

    it("DELETE revokes token when id is provided", async () => {
      const db = clientStub({
        api_tokens: { data: {} },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/tokens", {
        method: "DELETE",
        body: JSON.stringify({ id: "tok-1" }),
      });
      const res = await tokenDelete(req);
      expect(res.status).toBe(200);
    });

    it("DELETE returns 400 when id is missing", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: clientStub(),
      });
      const req = new NextRequest("http://localhost/api/tokens", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      const res = await tokenDelete(req);
      expect(res.status).toBe(400);
    });
  });

  describe("/api/settings/tags", () => {
    it("POST creates new tag", async () => {
      const db = clientStub({
        user_tags: { data: { id: "t1", name: "Groceries", color_slot: 1 } },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/settings/tags", {
        method: "POST",
        body: JSON.stringify({ name: "Groceries" }),
      });
      const res = await tagsPost(req);
      expect(res.status).toBe(201);
    });

    it("POST returns 400 for duplicate tag", async () => {
      const db = clientStub({
        user_tags: { error: { code: "23505" } },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/settings/tags", {
        method: "POST",
        body: JSON.stringify({ name: "Groceries" }),
      });
      const res = await tagsPost(req);
      expect(res.status).toBe(400);
    });

    it("PATCH renames tag via rpc", async () => {
      const db = {
        ...clientStub({
          user_tags: { data: [{ name: "Food" }] },
        }),
        rpc: vi.fn().mockResolvedValue({ error: null }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/settings/tags", {
        method: "PATCH",
        body: JSON.stringify({ oldName: "Food", newName: "Dining" }),
      });
      const res = await tagsPatch(req);
      expect(res.status).toBe(200);
    });

    it("DELETE removes tag", async () => {
      const db = clientStub({
        user_tags: { data: {} },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/settings/tags", {
        method: "DELETE",
        body: JSON.stringify({ name: "Food" }),
      });
      const res = await tagsDelete(req);
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/transactions/annotate", () => {
    it("returns 400 if transaction_id is missing", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: clientStub(),
      });
      const req = new NextRequest("http://localhost/api/transactions/annotate", {
        method: "POST",
        body: JSON.stringify({ note: "Missing ID" }),
      });
      const res = await annotatePost(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 if transaction is not found", async () => {
      const db = clientStub({
        transactions: { data: null },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/transactions/annotate", {
        method: "POST",
        body: JSON.stringify({ transaction_id: "t1", note: "Test" }),
      });
      const res = await annotatePost(req);
      expect(res.status).toBe(400);
    });

    it("saves note and tags for valid transaction", async () => {
      const db = clientStub({
        transactions: { data: { id: "t1", amount: 50, date: "2026-07-01" } },
        transaction_annotations: { data: {} },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/transactions/annotate", {
        method: "POST",
        body: JSON.stringify({ transaction_id: "t1", note: "Lunch with client", tags: ["work", "dining"] }),
      });
      const res = await annotatePost(req);
      expect(res.status).toBe(200);
    });
  });
});
