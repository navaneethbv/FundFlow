import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { PATCH as sinkingFundPatch, DELETE as sinkingFundDelete } from "@/app/api/sinking-funds/[id]/route";
import { GET as householdAcceptGet } from "@/app/api/household/accept/route";
import { POST as householdInvitePost } from "@/app/api/household/invite/route";
import { GET as settingsAuditGet } from "@/app/api/settings/audit/route";
import { POST as subCancelledPost, DELETE as subCancelledDelete } from "@/app/api/subscriptions/cancelled/route";
import { GET as adminStatsGet } from "@/app/api/admin/stats/route";
import { GET as exportCsvGet } from "@/app/api/export/csv/route";
import { GET as exportReportGet } from "@/app/api/export/report/route";
import { GET as exportQifGet } from "@/app/api/export/qif/route";
import { POST as plaidSharePost } from "@/app/api/plaid/share/route";
import { POST as tokensPost, DELETE as tokensDelete } from "@/app/api/tokens/route";
import { POST as plaidDisconnectPost } from "@/app/api/plaid/disconnect/route";
import { POST as plaidReconnectPost } from "@/app/api/plaid/reconnect/route";
import { POST as pushSubscribePost } from "@/app/api/push/subscribe/route";
import { POST as passkeysPost } from "@/app/api/settings/passkeys/route";
import { GET as sessionsGet, DELETE as sessionsDelete } from "@/app/api/settings/sessions/route";
import { POST as importCommitPost } from "@/app/api/import/commit/route";
import { POST as linkTokenPost } from "@/app/api/plaid/link-token/route";
import { POST as manualInvestmentsPost } from "@/app/api/investments/manual/route";
import { DELETE as manualAccountsDelete } from "@/app/api/manual-accounts/route";
import { PATCH as advicePatch } from "@/app/api/advice/route";
import { DELETE as accountDelete } from "@/app/api/account/route";
import { clientStub } from "../fixtures/supabase-query";
import * as http from "@/lib/http";
import * as rateLimit from "@/lib/rate-limit";

describe("More API Routes Boost Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Sinking Funds [id] Route", () => {
    it("handles unauthorized and mutation validation on PATCH and DELETE", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const req = new NextRequest("http://localhost/api/sinking-funds/sf-1");
      expect((await sinkingFundPatch(req, { params: Promise.resolve({ id: "sf-1" }) })).status).toBe(401);
      expect((await sinkingFundDelete(req, { params: Promise.resolve({ id: "sf-1" }) })).status).toBe(401);

      const client = clientStub({
        sinking_funds: { data: { id: "sf-1" } },
      });
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: client as never,
      });

      const service = await import("@/lib/supabase/service");
      vi.spyOn(service, "createServiceClient").mockReturnValue({
        from: vi.fn().mockReturnValue({
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      } as never);

      const reqBadJson = new NextRequest("http://localhost/api/sinking-funds/sf-1", {
        method: "PATCH",
        body: JSON.stringify({ target_amount: -50 }),
      });
      expect((await sinkingFundPatch(reqBadJson, { params: Promise.resolve({ id: "sf-1" }) })).status).toBe(400);

      const reqDelete = new NextRequest("http://localhost/api/sinking-funds/sf-1", { method: "DELETE" });
      expect((await sinkingFundDelete(reqDelete, { params: Promise.resolve({ id: "sf-1" }) })).status).toBe(200);
    });
  });

  describe("Household Accept and Audit Routes", () => {
    it("handles household accept invalid token and redirect", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1", email: "test@example.com" } as never,
        supabase: clientStub() as never,
      });

      const reqShortToken = new NextRequest("http://localhost/api/household/accept?token=short");
      const resShort = await householdAcceptGet(reqShortToken);
      expect(resShort.status).toBe(307);
    });

    it("handles household invite POST authorization, rate limit, validation, and email dispatch", async () => {
      // 1. Unauthorized
      vi.spyOn(http, "requireUser").mockResolvedValueOnce(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      expect((await householdInvitePost(new NextRequest("http://localhost/api/household/invite", { method: "POST" }))).status).toBe(401);

      // 2. Rate limited
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1", email: null } as never,
        supabase: clientStub() as never,
      });
      vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValueOnce(false);
      expect((await householdInvitePost(new NextRequest("http://localhost/api/household/invite", { method: "POST" }))).status).toBe(429);

      // 3. Validation errors
      vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValue(true);
      const reqBad = new NextRequest("http://localhost/api/household/invite", {
        method: "POST",
        body: JSON.stringify({ householdId: "h-1", email: "notanemail" }),
      });
      expect((await householdInvitePost(reqBad)).status).toBe(400);

      // 4. Household not found or not owner
      const clientNoOwner = clientStub({
        households: { data: { id: "h-1", owner_user_id: "other-user" } },
      });
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1", email: null } as never,
        supabase: clientNoOwner as never,
      });
      const reqNotFound = new NextRequest("http://localhost/api/household/invite", {
        method: "POST",
        body: JSON.stringify({ householdId: "h-1", email: "partner@example.com" }),
      });
      expect((await householdInvitePost(reqNotFound)).status).toBe(404);

      // 5. Successful invite with null user.email (tests user.email ?? fallback) and reporting email
      const reporting = await import("@/lib/reporting");
      const emailSpy = vi.spyOn(reporting, "sendHouseholdInviteEmail").mockResolvedValue({} as never);

      const clientSuccess = clientStub({
        households: { data: { id: "h-1", name: "Family", owner_user_id: "u-1" } },
        household_invites: { data: {} },
      });
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1", email: null } as never,
        supabase: clientSuccess as never,
      });
      const reqSuccess = new NextRequest("http://localhost/api/household/invite", {
        method: "POST",
        body: JSON.stringify({ householdId: "h-1", email: "partner@example.com" }),
      });
      const resSuccess = await householdInvitePost(reqSuccess);
      expect(resSuccess.status).toBe(200);
      expect(emailSpy).toHaveBeenCalledWith(
        "partner@example.com",
        "A FundFlow user",
        "Family",
        expect.stringContaining("/api/household/accept?token="),
      );
    });

    it("handles settings audit log retrieval", async () => {
      const client = clientStub({
        audit_log: {
          data: [{ id: "aud-1", user_id: "u-1", action: "login", created_at: "2026-08-20", metadata: {} }],
        },
      });
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: client as never,
      });

      const req = new NextRequest("http://localhost/api/settings/audit?limit=10");
      const res = await settingsAuditGet(req);
      expect(res.status).toBe(200);
    });
  });

  describe("Subscriptions Cancelled and Admin Stats Routes", () => {
    it("handles subscriptions cancelled POST and DELETE", async () => {
      const client = clientStub({
        cancelled_subscriptions: { data: [{ id: "cs-1" }] },
      });
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: client as never,
      });

      const reqPostBad = new NextRequest("http://localhost/api/subscriptions/cancelled", {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect((await subCancelledPost(reqPostBad)).status).toBe(400);

      const reqPostGood = new NextRequest("http://localhost/api/subscriptions/cancelled", {
        method: "POST",
        body: JSON.stringify({ merchant: "Netflix" }),
      });
      expect((await subCancelledPost(reqPostGood)).status).toBe(200);

      const reqDelete = new NextRequest("http://localhost/api/subscriptions/cancelled", {
        method: "DELETE",
        body: JSON.stringify({ merchant: "Netflix" }),
      });
      expect((await subCancelledDelete(reqDelete)).status).toBe(200);
    });

    it("handles admin stats unauthorized and success", async () => {
      vi.spyOn(http, "requireAdmin").mockResolvedValueOnce(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      expect((await adminStatsGet()).status).toBe(401);

      vi.spyOn(http, "requireAdmin").mockResolvedValueOnce({
        user: { id: "admin-1" } as never,
        supabase: clientStub() as never,
      });

      const service = await import("@/lib/supabase/service");
      vi.spyOn(service, "createServiceClient").mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ count: 10, error: null }),
        }),
      } as never);

      const res = await adminStatsGet();
      expect(res.status).toBe(200);
    });
  });

  describe("Export CSV, Report, and QIF Routes", () => {
    it("handles export CSV and QIF unauthorized and queries", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const req = new NextRequest("http://localhost/api/export/csv");
      expect((await exportCsvGet(req)).status).toBe(401);
      expect((await exportReportGet(req)).status).toBe(401);
      expect((await exportQifGet(req)).status).toBe(401);

      const client = clientStub({
        profiles: {
          data: { ai_export_enabled: true },
        },
        transactions: {
          data: [{ id: "tx-1", date: "2026-08-01", amount: 25, merchant_name: "Store", pfc_primary: "Groceries" }],
        },
        data_exports: { data: [{ id: "exp-1" }] },
      });
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: client as never,
      });

      const exportRoute = await import("@/lib/export-route");
      vi.spyOn(exportRoute, "recordExport").mockResolvedValue();

      const reqSuccess = new NextRequest("http://localhost/api/export/csv?from=2026-08-01&to=2026-08-31");
      expect((await exportCsvGet(reqSuccess)).status).toBe(200);
    });
  });

  describe("Plaid Share, Tokens, Passkeys, and Sessions Routes", () => {
    it("handles Plaid share POST", async () => {
      const client = clientStub({
        plaid_items: { data: { id: "item-1" } },
        households: { data: { id: "hh-1" } },
      });
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: client as never,
      });

      const service = await import("@/lib/supabase/service");
      vi.spyOn(service, "createServiceClient").mockReturnValue({
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      } as never);

      const reqPostBad = new NextRequest("http://localhost/api/plaid/share", {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect((await plaidSharePost(reqPostBad)).status).toBe(400);

      const reqPostGood = new NextRequest("http://localhost/api/plaid/share", {
        method: "POST",
        body: JSON.stringify({ itemId: "item-1", share: true, householdId: "hh-1" }),
      });
      expect((await plaidSharePost(reqPostGood)).status).toBe(200);
    });

    it("handles tokens POST and DELETE", async () => {
      const client = clientStub({
        api_tokens: { data: { id: "tok-1", name: "Test Token" } },
      });
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: client as never,
      });

      const reqPostBad = new NextRequest("http://localhost/api/tokens", {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect((await tokensPost(reqPostBad)).status).toBe(400);

      const reqPostGood = new NextRequest("http://localhost/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: "CI Token" }),
      });
      expect((await tokensPost(reqPostGood)).status).toBe(200);

      const reqDeleteGood = new NextRequest("http://localhost/api/tokens", {
        method: "DELETE",
        body: JSON.stringify({ id: "tok-1" }),
      });
      expect((await tokensDelete(reqDeleteGood)).status).toBe(200);
    });

    it("handles passkeys POST and sessions GET and DELETE", async () => {
      const client = clientStub({
        user_session_records: { data: [] },
      }) as ReturnType<typeof clientStub> & { auth: { getSession: ReturnType<typeof vi.fn> } };
      client.auth = {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      };

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: client as never,
      });

      const reqPasskeyBad = new NextRequest("http://localhost/api/settings/passkeys", {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect((await passkeysPost(reqPasskeyBad)).status).toBe(400);

      expect((await sessionsGet()).status).toBe(200);

      const service = await import("@/lib/supabase/service");
      vi.spyOn(service, "createServiceClient").mockReturnValue({
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      } as never);

      const reqSessionsDelete = new NextRequest("http://localhost/api/settings/sessions", {
        method: "DELETE",
        body: JSON.stringify({ session_id: "s-1" }),
      });
      expect((await sessionsDelete(reqSessionsDelete)).status).toBe(200);
    });

    it("handles push subscribe, plaid disconnect, and reconnect validation", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: clientStub() as never,
      });

      const reqPushBad = new NextRequest("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect((await pushSubscribePost(reqPushBad)).status).toBe(400);

      const reqDiscBad = new NextRequest("http://localhost/api/plaid/disconnect", {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect((await plaidDisconnectPost(reqDiscBad)).status).toBe(400);

      const reqReconBad = new NextRequest("http://localhost/api/plaid/reconnect", {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect((await plaidReconnectPost(reqReconBad)).status).toBe(400);
    });

    it("handles import commit POST validations and successful commit", async () => {
      const client = clientStub({
        accounts: { data: { id: "acc-1" } },
        import_review_rows: {
          data: [
            {
              id: "r-1",
              date: "2026-08-01",
              description: "Grocery Store",
              amount: 54.2,
              category: "food and drink",
              status: "pending",
            },
          ],
        },
      });

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: client as never,
      });

      const service = await import("@/lib/supabase/service");
      const chainableSelect = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { created_at: "2026-08-01T00:00:00Z" }, error: null }),
        then: (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: [] }),
      };
      vi.spyOn(service, "createServiceClient").mockReturnValue({
        from: vi.fn().mockReturnValue({
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ error: null }),
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
          select: chainableSelect.select,
          in: chainableSelect.in,
          eq: chainableSelect.eq,
          limit: chainableSelect.limit,
          maybeSingle: chainableSelect.maybeSingle,
          then: chainableSelect.then,
        }),
      } as never);

      const reqMissing = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect((await importCommitPost(reqMissing)).status).toBe(400);

      const reqSuccess = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({
          batch_id: "b-1",
          account_id: "acc-1",
          approved_row_ids: ["r-1"],
        }),
      });
      const resSuccess = await importCommitPost(reqSuccess);
      expect(resSuccess.status).toBe(200);

      // Without approved_row_ids and empty rows
      const emptyClient = clientStub({
        accounts: { data: { id: "acc-1" } },
        import_review_rows: { data: [] },
      });
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: emptyClient as never,
      });

      const reqNoApproved = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({
          batch_id: "b-1",
          account_id: "acc-1",
        }),
      });
      const resNoApproved = await importCommitPost(reqNoApproved);
      expect(resNoApproved.status).toBe(200);

      // Database error on row query
      const errClient = clientStub({
        accounts: { data: { id: "acc-1" } },
        import_review_rows: { error: new Error("Row query failed") },
      });
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: errClient as never,
      });
      const reqErr = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({
          batch_id: "b-1",
          account_id: "acc-1",
        }),
      });
      expect((await importCommitPost(reqErr)).status).toBe(500);
    });

    it("handles link token, manual investments, and manual accounts POST", async () => {
      const client = clientStub({
        manual_accounts: { data: [{ id: "m-1", name: "Manual Vault" }] },
      });

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: client as never,
      });

      const plaid = await import("@/lib/plaid");
      vi.spyOn(plaid, "getPlaidClient").mockReturnValue({
        linkTokenCreate: vi.fn().mockResolvedValue({
          data: { link_token: "link-token-xyz" },
        }),
      } as never);

      const rateLimit = await import("@/lib/rate-limit");
      vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValue(true);

      const plaidService = await import("@/lib/plaid-service");
      vi.spyOn(plaidService, "storeLinkToken").mockResolvedValue(undefined);

      const reqLink = new NextRequest("http://localhost/api/plaid/link-token", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const resLink = await linkTokenPost(reqLink);
      expect(resLink.status).toBe(200);

      const reqInvBad = new NextRequest("http://localhost/api/investments/manual", {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect((await manualInvestmentsPost(reqInvBad)).status).toBe(400);

      const reqDelBad = new NextRequest("http://localhost/api/manual-accounts", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      expect((await manualAccountsDelete(reqDelBad)).status).toBe(400);
    });

    it("handles advice PATCH validation, task toggling, and database errors", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: {} as never,
      });

      const service = await import("@/lib/supabase/service");
      vi.spyOn(service, "createServiceClient").mockReturnValue({
        from: vi.fn().mockReturnValue({
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      } as never);

      // Missing kind
      const reqNoKind = new NextRequest("http://localhost/api/advice", { method: "PATCH", body: JSON.stringify({}) });
      expect((await advicePatch(reqNoKind)).status).toBe(400);

      // Bad toggle_task params
      const reqBadToggle = new NextRequest("http://localhost/api/advice", {
        method: "PATCH",
        body: JSON.stringify({ kind: "toggle_task", adviceId: 123 }),
      });
      expect((await advicePatch(reqBadToggle)).status).toBe(400);

      // Unknown adviceId or taskId
      const reqUnknownAdvice = new NextRequest("http://localhost/api/advice", {
        method: "PATCH",
        body: JSON.stringify({ kind: "toggle_task", adviceId: "unknown-advice", taskId: "unknown-task", completed: true }),
      });
      expect((await advicePatch(reqUnknownAdvice)).status).toBe(400);

      // Valid toggle_task completed true and false
      const reqToggleTrue = new NextRequest("http://localhost/api/advice", {
        method: "PATCH",
        body: JSON.stringify({ kind: "toggle_task", adviceId: "emergency-fund", taskId: "compare-savings-to-one-month", completed: true }),
      });
      expect((await advicePatch(reqToggleTrue)).status).toBe(200);

      const reqToggleFalse = new NextRequest("http://localhost/api/advice", {
        method: "PATCH",
        body: JSON.stringify({ kind: "toggle_task", adviceId: "emergency-fund", taskId: "compare-savings-to-one-month", completed: false }),
      });
      expect((await advicePatch(reqToggleFalse)).status).toBe(200);

      // Database error on toggle
      vi.spyOn(service, "createServiceClient").mockReturnValue({
        from: vi.fn().mockReturnValue({
          upsert: vi.fn().mockResolvedValue({ error: new Error("DB upsert failure") }),
        }),
      } as never);

      const reqToggleErr = new NextRequest("http://localhost/api/advice", {
        method: "PATCH",
        body: JSON.stringify({ kind: "toggle_task", adviceId: "emergency-fund", taskId: "compare-savings-to-one-month", completed: true }),
      });
      expect((await advicePatch(reqToggleErr)).status).toBe(500);
    });
  });

  describe("Account Route Delete Branches", () => {
    it("handles rate limiting, invalid code, TOTP verify exception, and user without email", async () => {
      // 1. Unauthorized
      vi.spyOn(http, "requireUser").mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      expect((await accountDelete(new NextRequest("http://localhost/api/account", { method: "DELETE" }))).status).toBe(401);

      // 2. Rate limit hit
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1", email: "u1@test.com" } as never,
        supabase: {} as never,
      });
      vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValue(false);
      expect((await accountDelete(new NextRequest("http://localhost/api/account", { method: "DELETE" }))).status).toBe(429);

      // 3. Rate limit ok, but missing/empty code
      vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValue(true);
      const reqNoCode = new NextRequest("http://localhost/api/account", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      expect((await accountDelete(reqNoCode)).status).toBe(400);

      // 4. TOTP factors exception during challengeAndVerify -> fallback fails
      const mockSupabaseTotp = {
        auth: {
          mfa: {
            listFactors: vi.fn().mockResolvedValue({
              data: {
                totp: [{ id: "factor-1", status: "verified" }],
              },
            }),
            challengeAndVerify: vi.fn().mockImplementation(() => {
              throw new Error("Challenge boom");
            }),
          },
        },
      };
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1", email: "u1@test.com" } as never,
        supabase: mockSupabaseTotp as never,
      });
      const reqWithCode = () =>
        new NextRequest("http://localhost/api/account", {
          method: "DELETE",
          body: JSON.stringify({ code: "123456" }),
        });
      expect((await accountDelete(reqWithCode())).status).toBe(401);

      // 5. User without email falls back and fails
      const mockSupabaseNoTotp = {
        auth: {
          mfa: {
            listFactors: vi.fn().mockResolvedValue({ data: null }),
          },
        },
      };
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1", email: null } as never,
        supabase: mockSupabaseNoTotp as never,
      });
      expect((await accountDelete(reqWithCode())).status).toBe(401);
    });
  });
});
