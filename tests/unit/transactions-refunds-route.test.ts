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

const mockWriteAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
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
        from: vi.fn().mockImplementation((table) => {
          if (table === "transaction_review_decisions") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
            };
          }
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
            }),
          };
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
            refund_amount: 0,
            partial: false,
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
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null }),
            }),
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
            const decisionsEqUser = vi.fn().mockResolvedValue({ data: [] });
            const decisionsEqKind = vi.fn().mockReturnValue({ eq: decisionsEqUser });
            return {
              select: vi.fn().mockReturnValue({ eq: decisionsEqKind }),
              decisionsEqKind,
              decisionsEqUser,
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
            refund_amount: 50,
            partial: false,
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
        in: vi.fn().mockResolvedValue({
          data: [
            { id: "charge-1", amount: 50 },
            { id: "refund-1", amount: -50 },
          ],
          error: null,
        }),
      });
      const rpc = vi.fn().mockResolvedValue({ error: { message: "Link error" } });
      const selectLinks = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          or: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          rpc,
          from: vi.fn().mockImplementation((table) => ({
            select: table === "linked_refunds" ? selectLinks : vi.fn().mockReturnValue({ eq: owned }),
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

    it("calls confirm_refund_link RPC if confirmed", async () => {
      const owned = vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({
          data: [
            { id: "charge-1", amount: 50 },
            { id: "refund-1", amount: -50 },
          ],
          error: null,
        }),
      });
      const rpc = vi.fn().mockResolvedValue({ error: null });
      const selectLinks = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          or: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });
      const mockSupabase = {
        rpc,
        from: vi.fn().mockImplementation((table) => ({
          select: table === "linked_refunds" ? selectLinks : vi.fn().mockReturnValue({ eq: owned }),
        })),
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

      expect(rpc).toHaveBeenCalledWith("confirm_refund_link", {
        p_user_id: "u1",
        p_subject_id: "charge-1:refund-1",
        p_charge_id: "charge-1",
        p_refund_id: "refund-1",
        p_amount: 50,
      });
      // A-11: money-linking mutations are audited.
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", action: "refund_confirmed" }),
      );
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

    it("rejects when charge_id equals refund_id or subject_id is mismatched", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: { from: vi.fn() },
      });

      // chargeId === refundId
      const res1 = await POST({
        json: () =>
          Promise.resolve({
            subject_id: "c1:c1",
            decision: "confirmed",
            charge_id: "c1",
            refund_id: "c1",
            amount: 50,
          }),
      } as unknown as NextRequest);
      expect(res1.status).toBe(400);

      // mismatched subject_id
      const res2 = await POST({
        json: () =>
          Promise.resolve({
            subject_id: "wrong-subject",
            decision: "confirmed",
            charge_id: "c1",
            refund_id: "r1",
            amount: 50,
          }),
      } as unknown as NextRequest);
      expect(res2.status).toBe(400);
    });

    it("rejects non-positive charge or non-negative refund or excessive amount", async () => {
      const owned = (data: unknown[]) => ({
        in: vi.fn().mockResolvedValue({ data }),
      });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table) => {
          if (table === "transactions") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue(
                  owned([
                    { id: "c1", amount: -50 }, // negative charge (invalid)
                    { id: "r1", amount: 50 },  // positive refund (invalid)
                  ]),
                ),
              }),
            };
          }
          return { select: vi.fn() };
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });

      const res = await POST({
        json: () =>
          Promise.resolve({
            subject_id: "c1:r1",
            decision: "confirmed",
            charge_id: "c1",
            refund_id: "r1",
            amount: 50,
          }),
      } as unknown as NextRequest);
      expect(res.status).toBe(400);

      // Excessive amount
      const mockSupabase2 = {
        from: vi.fn().mockImplementation((table) => {
          if (table === "transactions") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue(
                  owned([
                    { id: "c1", amount: 50 },
                    { id: "r1", amount: -50 },
                  ]),
                ),
              }),
            };
          }
          return { select: vi.fn() };
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase2,
      });

      const resExcess = await POST({
        json: () =>
          Promise.resolve({
            subject_id: "c1:r1",
            decision: "confirmed",
            charge_id: "c1",
            refund_id: "r1",
            amount: 100, // exceeds 50
          }),
      } as unknown as NextRequest);
      expect(resExcess.status).toBe(400);
    });

    it("returns 409 conflict when existing refund links exist or rpc reports conflict", async () => {
      const owned = (data: unknown[]) => ({
        in: vi.fn().mockResolvedValue({ data }),
      });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table) => {
          if (table === "transactions") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue(
                  owned([
                    { id: "c1", amount: 50 },
                    { id: "r1", amount: -50 },
                  ]),
                ),
              }),
            };
          }
          if (table === "linked_refunds") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  or: vi.fn().mockResolvedValue({
                    data: [{ charge_transaction_id: "c1", refund_transaction_id: "other" }],
                  }),
                }),
              }),
            };
          }
          return { select: vi.fn() };
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });

      const resConflict = await POST({
        json: () =>
          Promise.resolve({
            subject_id: "c1:r1",
            decision: "confirmed",
            charge_id: "c1",
            refund_id: "r1",
          }),
      } as unknown as NextRequest);
      expect(resConflict.status).toBe(409);

      // RPC conflict branch
      const mockSupabaseRpcConflict = {
        from: vi.fn().mockImplementation((table) => {
          if (table === "transactions") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue(
                  owned([
                    { id: "c1", amount: 50 },
                    { id: "r1", amount: -50 },
                  ]),
                ),
              }),
            };
          }
          if (table === "linked_refunds") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  or: vi.fn().mockResolvedValue({ data: [] }),
                }),
              }),
            };
          }
          return { select: vi.fn() };
        }),
        rpc: vi.fn().mockResolvedValue({
          error: { message: "refund_link_conflict: already linked" },
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabaseRpcConflict,
      });

      const resRpcConflict = await POST({
        json: () =>
          Promise.resolve({
            subject_id: "c1:r1",
            decision: "confirmed",
            charge_id: "c1",
            refund_id: "r1",
          }),
      } as unknown as NextRequest);
      expect(resRpcConflict.status).toBe(409);
    });
  });
});
