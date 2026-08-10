import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn();
const mockErrorResponse = vi.fn();
const mockBadRequest = vi.fn((msg) => new Response(msg, { status: 400 }));
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (msg: string) => mockBadRequest(msg),
}));

const mockDetectRefundPairs = vi.fn();
const mockFilterReviewDecisions = vi.fn();
vi.mock("@/lib/transaction-quality", () => ({
  detectRefundPairs: (...args: unknown[]) => mockDetectRefundPairs(...args),
  filterReviewDecisions: (...args: unknown[]) =>
    mockFilterReviewDecisions(...args),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(() => true);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

import { GET, POST } from "@/app/api/transactions/refunds/route";
import { NextRequest, NextResponse } from "next/server";

describe("Transactions Refunds API Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
    mockErrorResponse.mockReturnValue(new Response("error", { status: 500 }));
  });

  describe("GET /api/transactions/refunds", () => {
    it("returns the auth response when not signed in", async () => {
      mockRequireUser.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it("returns 429 when rate limited", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
      mockCheckRateLimit.mockResolvedValue(false);
      const res = await GET();
      expect(res.status).toBe(429);
    });

    it("returns placeholders when ledger data is missing", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: null }),
              }),
            }),
          }),
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });
      mockDetectRefundPairs.mockReturnValue([
        { chargeId: "missing-charge", refundId: "missing-refund", amount: 50 },
      ]);
      mockFilterReviewDecisions.mockReturnValue([
        { subjectId: "missing-charge:missing-refund" },
      ]);

      const res = await GET();
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        pairs: [
          {
            subject_id: "missing-charge:missing-refund",
            charge_id: "missing-charge",
            refund_id: "missing-refund",
            merchant: "Unknown",
            charge_date: null,
            refund_date: null,
            amount: 0,
          },
        ],
      });
    });

    it("falls back through name and empty merchant when merchant_name is null", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table) => {
          if (table === "transactions") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({
                data: [
                  { id: "t1", date: "2026-07-01", merchant_name: null, name: "Store", amount: 50 },
                  { id: "t3", date: "2026-07-02", merchant_name: null, name: null, amount: 30 },
                ],
              }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: null }),
          };
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });
      mockDetectRefundPairs.mockReturnValue([
        { chargeId: "t1", refundId: "missing-refund", amount: 50 },
        { chargeId: "t3", refundId: "missing-refund", amount: 30 },
      ]);
      mockFilterReviewDecisions.mockReturnValue([
        { subjectId: "t1:missing-refund" },
        { subjectId: "t3:missing-refund" },
      ]);

      const res = await GET();
      const body = await res.json();
      expect(body.pairs.map((p: { merchant: string }) => p.merchant)).toEqual([
        "Store",
        "",
      ]);
    });

    it("returns detected refund pairs waiting review", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table) => {
          if (table === "transactions") {
            return {
              select: vi.fn().mockReturnThis(),
              // Own ledger only: a household member's shared refunds must not
              // be paired against this caller's charges.
              eq: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "charge-1",
                    date: "2026-07-01",
                    merchant_name: "Store",
                    amount: 50,
                  },
                  {
                    id: "refund-1",
                    date: "2026-07-03",
                    merchant_name: "Store",
                    amount: -50,
                  },
                ],
              }),
            };
          }
          if (table === "transaction_review_decisions") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ data: [] }),
            };
          }
          return null as never;
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });

      mockDetectRefundPairs.mockReturnValue([
        { chargeId: "charge-1", refundId: "refund-1" },
      ]);
      mockFilterReviewDecisions.mockReturnValue([
        { subjectId: "charge-1:refund-1" },
      ]);

      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        pairs: [
          {
            subject_id: "charge-1:refund-1",
            charge_id: "charge-1",
            refund_id: "refund-1",
            merchant: "Store",
            charge_date: "2026-07-01",
            refund_date: "2026-07-03",
            amount: 50,
          },
        ],
      });
    });
  });

  describe("POST /api/transactions/refunds", () => {
    it("returns the auth response when not signed in", async () => {
      mockRequireUser.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
      const res = await POST({} as NextRequest);
      expect(res.status).toBe(401);
    });

    it("returns 429 when rate limited", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
      mockCheckRateLimit.mockResolvedValue(false);
      const res = await POST({} as NextRequest);
      expect(res.status).toBe(429);
    });

    it("returns 500 when the decision upsert fails", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            upsert: vi.fn().mockResolvedValue({ error: { message: "Upsert error" } }),
          }),
        },
      });
      const request = {
        json: () =>
          Promise.resolve({ subject_id: "charge-1:refund-1", decision: "dismissed" }),
      } as unknown as NextRequest;
      const res = await POST(request);
      expect(res.status).toBe(500);
    });

    it("requires link ids and amount when confirming", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            upsert: vi.fn().mockResolvedValue({ error: null }),
          }),
        },
      });
      const request = {
        json: () =>
          Promise.resolve({ subject_id: "charge-1:refund-1", decision: "confirmed" }),
      } as unknown as NextRequest;
      const res = await POST(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "charge_id, refund_id, and amount are required to link a refund",
      );
    });

    it("returns 500 when verifying ownership fails", async () => {
      const owned = vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: null, error: { message: "Ownership error" } }),
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ eq: owned }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          }),
        },
      });
      const request = {
        json: () =>
          Promise.resolve({
            subject_id: "charge-1:refund-1",
            decision: "confirmed",
            charge_id: "charge-1",
            refund_id: "refund-1",
            amount: 50,
          }),
      } as unknown as NextRequest;
      const res = await POST(request);
      expect(res.status).toBe(500);
    });

    it("rejects a link when the ownership query returns no rows", async () => {
      const owned = vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ eq: owned }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          }),
        },
      });
      const request = {
        json: () =>
          Promise.resolve({
            subject_id: "charge-1:refund-1",
            decision: "confirmed",
            charge_id: "charge-1",
            refund_id: "refund-1",
            amount: 50,
          }),
      } as unknown as NextRequest;
      const res = await POST(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "charge and refund must both be your own transactions",
      );
    });

    it("returns 500 when linking the refund fails", async () => {
      const owned = vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: [{ id: "charge-1" }, { id: "refund-1" }], error: null }),
      });
      const linkUpsert = vi.fn().mockResolvedValue({ error: { message: "Link error" } });
      const upsert = vi.fn().mockResolvedValue({ error: null });
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockImplementation((table) => ({
            select: vi.fn().mockReturnValue({ eq: owned }),
            upsert: table === "linked_refunds" ? linkUpsert : upsert,
          })),
        },
      });
      const request = {
        json: () =>
          Promise.resolve({
            subject_id: "charge-1:refund-1",
            decision: "confirmed",
            charge_id: "charge-1",
            refund_id: "refund-1",
            amount: 50,
          }),
      } as unknown as NextRequest;
      const res = await POST(request);
      expect(res.status).toBe(500);
    });

    it("returns bad request if decision is invalid", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const request = {
        json: () =>
          Promise.resolve({
            subject_id: "charge-1:refund-1",
            decision: "invalid",
          }),
      } as unknown as NextRequest;

      const res = await POST(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "subject_id and a valid decision are required",
      );
    });

    it("upserts decision and links refund if confirmed", async () => {
      const owned = vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({
          data: [{ id: "charge-1" }, { id: "refund-1" }],
          error: null,
        }),
      });
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ eq: owned }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });
      const request = {
        json: () =>
          Promise.resolve({
            subject_id: "charge-1:refund-1",
            decision: "confirmed",
            charge_id: "charge-1",
            refund_id: "refund-1",
            amount: 50,
          }),
      } as unknown as NextRequest;

      const res = await POST(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });

      expect(mockSupabase.from).toHaveBeenCalledWith(
        "transaction_review_decisions",
      );
      expect(mockSupabase.from).toHaveBeenCalledWith("linked_refunds");
    });

    it("rejects a confirmed link when the transactions are not the caller's", async () => {
      const owned = vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: [{ id: "charge-1" }], error: null }),
      });
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ eq: owned }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });
      const request = {
        json: () =>
          Promise.resolve({
            subject_id: "charge-1:refund-1",
            decision: "confirmed",
            charge_id: "charge-1",
            refund_id: "refund-1",
            amount: 50,
          }),
      } as unknown as NextRequest;

      const res = await POST(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "charge and refund must both be your own transactions",
      );
      expect(mockSupabase.from).not.toHaveBeenCalledWith("linked_refunds");
    });

    it("upserts decision and does not link if dismissed", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });
      const request = {
        json: () =>
          Promise.resolve({
            subject_id: "charge-1:refund-1",
            decision: "dismissed",
          }),
      } as unknown as NextRequest;

      const res = await POST(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });

      expect(mockSupabase.from).toHaveBeenCalledWith(
        "transaction_review_decisions",
      );
      expect(mockSupabase.from).not.toHaveBeenCalledWith("linked_refunds");
    });
  });
});
