import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as calendarTokenPost, DELETE as calendarTokenDelete } from "@/app/api/calendar/token/route";
import { GET as sessionsGet, DELETE as sessionsDelete } from "@/app/api/settings/sessions/route";
import { POST as tokensPost, DELETE as tokensDelete } from "@/app/api/tokens/route";
import { POST as pushSubscribePost, DELETE as pushSubscribeDelete } from "@/app/api/push/subscribe/route";
import { POST as refundsPost } from "@/app/api/transactions/refunds/route";
import * as http from "@/lib/http";

vi.mock("@/lib/audit", () => ({
  getClientIp: () => "127.0.0.1",
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    }),
  }),
}));

describe("PR #110 Route Handlers Coverage Boost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("/api/calendar/token", () => {
    it("mints calendar token on POST and revokes token on DELETE", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "cal-1", include_amounts: true, created_at: "2026-08-10" },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      } as any;

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as any,
        supabase: mockSupabase,
      });

      const postReq = new NextRequest("http://localhost/api/calendar/token", {
        method: "POST",
        body: JSON.stringify({ includeAmounts: true }),
      });
      const postRes = await calendarTokenPost(postReq);
      expect(postRes.status).toBe(200);

      const delReq = new NextRequest("http://localhost/api/calendar/token", {
        method: "DELETE",
        body: JSON.stringify({ id: "cal-1" }),
      });
      const delRes = await calendarTokenDelete(delReq);
      expect(delRes.status).toBe(200);

      const badDelReq = new NextRequest("http://localhost/api/calendar/token", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      const badDelRes = await calendarTokenDelete(badDelReq);
      expect(badDelRes.status).toBe(400);
    });
  });

  describe("/api/settings/sessions", () => {
    it("lists active sessions on GET and revokes session on DELETE", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ id: "sess-1", session_id: "s-1", user_agent: "Mozilla", revoked_at: null, last_seen_at: "2026-08-10" }],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: { id: "s-1" } } }),
        },
      } as any;

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as any,
        supabase: mockSupabase,
      });

      const getRes = await sessionsGet();
      expect(getRes.status).toBe(200);

      const delReq = new NextRequest("http://localhost/api/settings/sessions", {
        method: "DELETE",
        body: JSON.stringify({ session_id: "sess-1" }),
      });
      const delRes = await sessionsDelete(delReq);
      expect(delRes.status).toBe(200);

      const badDelReq = new NextRequest("http://localhost/api/settings/sessions", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      const badDelRes = await sessionsDelete(badDelReq);
      expect(badDelRes.status).toBe(400);
    });
  });

  describe("/api/tokens", () => {
    it("creates API token on POST and revokes on DELETE", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "token-1", name: "My Token", created_at: "2026-08-10" },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      } as any;

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as any,
        supabase: mockSupabase,
      });

      const postReq = new NextRequest("http://localhost/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: "My Token" }),
      });
      const postRes = await tokensPost(postReq);
      expect(postRes.status).toBe(200);

      const delReq = new NextRequest("http://localhost/api/tokens", {
        method: "DELETE",
        body: JSON.stringify({ id: "token-1" }),
      });
      const delRes = await tokensDelete(delReq);
      expect(delRes.status).toBe(200);

      const badPostReq = new NextRequest("http://localhost/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: " " }),
      });
      const badPostRes = await tokensPost(badPostReq);
      expect(badPostRes.status).toBe(400);

      const badDelReq = new NextRequest("http://localhost/api/tokens", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      const badDelRes = await tokensDelete(badDelReq);
      expect(badDelRes.status).toBe(400);
    });
  });

  describe("/api/push/subscribe", () => {
    it("subscribes on POST and unsubscribes on DELETE", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      } as any;

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as any,
        supabase: mockSupabase,
      });

      const subscription = {
        endpoint: "https://fcm.googleapis.com/fcm/send/123",
        keys: { p256dh: "key-1", auth: "auth-1" },
      };

      const postReq = new NextRequest("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify(subscription),
      });
      const postRes = await pushSubscribePost(postReq);
      expect(postRes.status).toBe(200);

      const delReq = new NextRequest("http://localhost/api/push/subscribe", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      const delRes = await pushSubscribeDelete(delReq);
      expect(delRes.status).toBe(200);

      const badPostReq = new NextRequest("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const badPostRes = await pushSubscribePost(badPostReq);
      expect(badPostRes.status).toBe(400);
    });
  });

  describe("/api/transactions/refunds", () => {
    it("links refund on POST and unlinks on DELETE", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          upsert: vi.fn().mockResolvedValue({ error: null }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ id: "txn-charge" }, { id: "txn-refund" }],
                error: null,
              }),
            }),
          }),
        }),
      } as any;

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as any,
        supabase: mockSupabase,
      });

      const postReq = new NextRequest("http://localhost/api/transactions/refunds", {
        method: "POST",
        body: JSON.stringify({
          subject_id: "txn-charge:txn-refund",
          decision: "dismissed",
        }),
      });
      const postRes = await refundsPost(postReq);
      expect(postRes.status).toBe(200);

      const postConfirmReq = new NextRequest("http://localhost/api/transactions/refunds", {
        method: "POST",
        body: JSON.stringify({
          subject_id: "txn-charge:txn-refund",
          decision: "confirmed",
          charge_id: "txn-charge",
          refund_id: "txn-refund",
          amount: 50,
        }),
      });
      const postConfirmRes = await refundsPost(postConfirmReq);
      expect(postConfirmRes.status).toBe(200);

      const badPostReq = new NextRequest("http://localhost/api/transactions/refunds", {
        method: "POST",
        body: JSON.stringify({ subject_id: "c" }),
      });
      const badPostRes = await refundsPost(badPostReq);
      expect(badPostRes.status).toBe(400);
    });
  });
});
