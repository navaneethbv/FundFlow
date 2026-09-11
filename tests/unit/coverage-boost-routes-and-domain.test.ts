import { describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn((_ctx: unknown, err: unknown) =>
  NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 500 }),
);
const mockBadRequest = vi.fn((msg: unknown) =>
  NextResponse.json({ error: String(msg) }, { status: 400 }),
);

vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (_ctx: unknown, err: unknown) => mockErrorResponse(_ctx, err),
  badRequest: (msg: unknown) => mockBadRequest(msg),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(() => Promise.resolve(true));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => mockCheckRateLimit(),
}));

let mockServiceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
  getClientIp: () => "127.0.0.1",
}));

import { GET as transfersGet, POST as transfersPost } from "@/app/api/transactions/transfers/route";
import {
  GET as lifeEventsGet,
  POST as lifeEventsPost,
  PATCH as lifeEventsPatch,
  DELETE as lifeEventsDelete,
} from "@/app/api/forecasting/life-events/route";
import { POST as demoPost, DELETE as demoDelete } from "@/app/api/demo/route";
import { calculateFireSimulation } from "@/lib/fire-simulator";
import { isRegexShapeSafe } from "@/lib/regex-safety";

function makeJsonReq(body: unknown, method = "POST"): NextRequest {
  return {
    method,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as NextRequest;
}

describe("Routes and Domain Coverage Boost", () => {
  describe("app/api/transactions/transfers/route.ts", () => {
    it("handles account names mapping in GET", async () => {
      const authClient = clientStub({
        transactions: { data: [] },
        transaction_review_decisions: { data: [] },
        linked_transfers: { data: [] },
        accounts: { data: [{ id: "a1", name: "Checking 1" }] },
        manual_accounts: { data: [{ id: "m1", name: "Manual Cash" }] },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const res = await transfersGet();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.pairs).toEqual([]);
    });

    it("rejects when outRow or inRow is missing in confirm transfer link", async () => {
      const authClient = clientStub({
        transactions: {
          data: [
            { id: "t1", amount: -100, date: "2026-01-01", account_id: "a1" },
          ],
        },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const res = await transfersPost(
        makeJsonReq({
          decision: "confirmed",
          subject_id: "t1:t2",
          out_id: "t1",
          in_id: "t2",
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("both sides of a transfer must be your own transactions");
    });

    it("handles dismissed decision in single transfer POST", async () => {
      const authClient = clientStub({
        transaction_review_decisions: { data: null },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const res = await transfersPost(
        makeJsonReq({
          decision: "dismissed",
          subject_id: "t1:t2",
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("validates bulk transfer request constraints", async () => {
      const authClient = clientStub();
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      // Non-confirmed bulk
      const resBadDecision = await transfersPost(
        makeJsonReq({
          decision: "dismissed",
          transfers: [{ subject_id: "s1" }],
        }),
      );
      expect(resBadDecision.status).toBe(400);

      // Empty transfers array
      const resEmpty = await transfersPost(
        makeJsonReq({
          decision: "confirmed",
          transfers: [],
        }),
      );
      expect(resEmpty.status).toBe(400);
    });

    it("handles bulk transfer candidates with failure reporting", async () => {
      const authClient = clientStub({
        transactions: { data: [] },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const res = await transfersPost(
        makeJsonReq({
          decision: "confirmed",
          transfers: [
            "not-an-object",
            {
              subject_id: "t1:t2",
              out_id: "t1",
              in_id: "t2",
            },
          ],
        }),
      );
      expect(res.status).toBe(207);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.failures.length).toBe(2);
    });
  });

  describe("app/api/forecasting/life-events/route.ts", () => {
    it("lists life events in GET", async () => {
      const authClient = clientStub({
        life_events: {
          data: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              event_type: "child",
              start_month: 6,
              amount: 1200,
              duration_months: 24,
              label: "Newborn",
            },
          ],
        },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const res = await lifeEventsGet();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.events.length).toBe(1);
      expect(json.events[0].type).toBe("child");
    });

    it("handles db error on create in POST", async () => {
      const authClient = {
        from: (table: string) => {
          if (table === "life_events") {
            return {
              insert: () => ({
                select: () => ({
                  single: async () => ({ data: null, error: new Error("db_insert_failed") }),
                }),
              }),
            };
          }
          return { select: () => ({}) };
        },
      };
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const res = await lifeEventsPost(
        makeJsonReq({
          type: "income_change",
          startMonth: 3,
          amount: 5000,
          durationMonths: 12,
          label: "Promotion",
        }),
      );
      expect(res.status).toBe(500);
    });

    it("validates eventId and not found on PATCH", async () => {
      const authClient = clientStub({
        life_events: { data: null },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      // Invalid UUID
      const resBadId = await lifeEventsPatch(
        makeJsonReq({
          id: "invalid-uuid",
          type: "expense_change",
          startMonth: 1,
          amount: 500,
          durationMonths: 6,
        }, "PATCH"),
      );
      expect(resBadId.status).toBe(400);

      // Valid UUID but not found in DB
      const resNotFound = await lifeEventsPatch(
        makeJsonReq({
          id: "00000000-0000-0000-0000-000000000002",
          type: "expense_change",
          startMonth: 1,
          amount: 500,
          durationMonths: 6,
        }, "PATCH"),
      );
      expect(resNotFound.status).toBe(400);
      const jsonNotFound = await resNotFound.json();
      expect(jsonNotFound.error).toBe("Life event not found");
    });

    it("validates eventId and not found on DELETE", async () => {
      const authClient = clientStub({
        life_events: { data: null },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      // Invalid UUID
      const resBadId = await lifeEventsDelete(
        makeJsonReq({ id: "invalid-uuid" }, "DELETE"),
      );
      expect(resBadId.status).toBe(400);

      // Not found
      const resNotFound = await lifeEventsDelete(
        makeJsonReq({ id: "00000000-0000-0000-0000-000000000003" }, "DELETE"),
      );
      expect(resNotFound.status).toBe(400);
      const json = await resNotFound.json();
      expect(json.error).toBe("Life event not found");
    });

    it("successfully deletes life event", async () => {
      const authClient = clientStub({
        life_events: { data: { id: "00000000-0000-0000-0000-000000000004" } },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const res = await lifeEventsDelete(
        makeJsonReq({ id: "00000000-0000-0000-0000-000000000004" }, "DELETE"),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe("app/api/demo/route.ts", () => {
    it("handles demo rate limit rejection", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: clientStub() });
      mockCheckRateLimit.mockResolvedValue(false);

      const res = await demoPost();
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toContain("Too many demo requests");
    });

    it("refuses loading demo data when real bank is connected", async () => {
      const authClient = clientStub({
        plaid_items: {
          data: [{ plaid_item_id: "ins_real_bank_123" }],
        },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });
      mockCheckRateLimit.mockResolvedValue(true);

      const res = await demoPost();
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toContain("Demo data can't be loaded while a real bank is connected");
    });

    it("successfully loads demo data", async () => {
      const authClient = clientStub({
        plaid_items: {
          data: [{ plaid_item_id: "demo-item-123" }],
        },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });
      mockCheckRateLimit.mockResolvedValue(true);

      mockServiceClient = clientStub({
        plaid_items: { data: { id: "item-row-1" } },
        accounts: { data: [{ id: "acc-1" }, { id: "acc-2" }] },
        account_balance_snapshots: { data: null },
        transactions: { data: null },
      });

      const res = await demoPost();
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.transactions).toBeGreaterThan(0);
    });

    it("successfully clears demo data in DELETE", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
      mockServiceClient = clientStub({
        plaid_items: { data: null },
      });

      const res = await demoDelete();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe("lib/fire-simulator.ts", () => {
    it("simulates ongoing monthly spend delta life events", () => {
      const res = calculateFireSimulation({
        currentNetWorth: 100_000,
        monthlyIncome: 8_000,
        monthlySpend: 4_000,
        monthlySavings: 4_000,
        annualReturnPct: 7.0,
        withdrawalRatePct: 4.0,
        currentAge: 30,
        projectionHorizonMonths: 12,
        lifeEvents: [
          {
            id: "ev1",
            name: "Daycare",
            monthOffset: 2,
            oneTimeCashFlow: 0,
            ongoingMonthlySpendDelta: 1500,
          },
        ],
      });

      expect(res.timeline.length).toBe(13);
      expect(res.timeline[3]!.netWorthWithEvents).toBeDefined();
    });
  });

  describe("lib/regex-safety.ts", () => {
    it("tests word class and whitespace class overlap in regex validation", () => {
      expect(isRegexShapeSafe("(\\w+a)+")).toBe(false);
      expect(isRegexShapeSafe("(\\s+ )+")).toBe(false);
      expect(isRegexShapeSafe("^[a-z]+$")).toBe(true);
      expect(isRegexShapeSafe("a{1,2}b{1,2}")).toBe(true);
      expect(isRegexShapeSafe("[\\u0000-\\uffff]+")).toBe(true);
    });
  });
});
