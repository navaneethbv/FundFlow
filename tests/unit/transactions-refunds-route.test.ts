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

import { GET, POST } from "@/app/api/transactions/refunds/route";
import { NextResponse, NextRequest } from "next/server";

describe("Transactions Refunds API Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/transactions/refunds", () => {
    it("returns detected refund pairs waiting review", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table) => {
          if (table === "transactions") {
            return {
              select: vi.fn().mockReturnThis(),
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
