import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as goalsAccountPost, DELETE as goalsAccountDelete } from "@/app/api/goals/accounts/route";
import { clientStub } from "../fixtures/supabase-query";
import * as http from "@/lib/http";
import * as rateLimit from "@/lib/rate-limit";

describe("Goals Accounts Route Branch Coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles validation and mode conflicts on POST", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {} as never,
    });

    vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValueOnce(false);
    const reqRate = new NextRequest("http://localhost/api/goals/accounts", { method: "POST" });
    expect((await goalsAccountPost(reqRate)).status).toBe(429);

    vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValue(true);

    const invalidBodies = [
      {}, // missing goalId
      { goalId: "g-1" }, // missing accountId
      { goalId: "g-1", accountId: "a-1" }, // missing allocatedAmount when not useEntireBalance
      { goalId: "g-1", accountId: "a-1", allocatedAmount: -10 },
      { goalId: "g-1", accountId: "a-1", useEntireBalance: true, allocatedAmount: 500 }, // mode conflict
    ];

    for (const body of invalidBodies) {
      const req = new NextRequest("http://localhost/api/goals/accounts", {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect((await goalsAccountPost(req)).status).toBe(400);
    }
  });

  it("handles RPC allocation conflicts and captures pay_down baseline", async () => {
    vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValue(true);

    const client = clientStub({
      goals: {
        data: {
          id: "g-paydown",
          goal_type: "pay_down",
          starting_balance: null,
          target_amount: 1000,
        },
      },
      accounts: {
        data: {
          id: "a-credit",
          type: "credit",
          current_balance: 3000,
        },
      },
    });
    const rpcMock = vi.fn().mockResolvedValueOnce({
      data: null,
      error: { message: "account_already_fully_allocated" },
    });
    const mockClient = { ...client, rpc: rpcMock };

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: mockClient as never,
    });

    const reqConflict = new NextRequest("http://localhost/api/goals/accounts", {
      method: "POST",
      body: JSON.stringify({
        goalId: "g-paydown",
        accountId: "a-credit",
        useEntireBalance: true,
      }),
    });
    expect((await goalsAccountPost(reqConflict)).status).toBe(409);

    // Successful allocation and baseline capture
    mockClient.rpc = vi.fn().mockResolvedValueOnce({
      data: "alloc-1",
      error: null,
    }) as never;

    const reqSuccess = new NextRequest("http://localhost/api/goals/accounts", {
      method: "POST",
      body: JSON.stringify({
        goalId: "g-paydown",
        accountId: "a-credit",
        useEntireBalance: true,
      }),
    });
    const resSuccess = await goalsAccountPost(reqSuccess);
    expect(resSuccess.status).toBe(200);
    const json = await resSuccess.json();
    expect(json.baselineCaptured).toBe(true);

    // Pay_down goal with null current_balance, null target_amount, and baseline update error
    const clientNullBal = {
      ...clientStub({
        goals: {
          data: {
            id: "g-paydown-null",
            goal_type: "pay_down",
            starting_balance: null,
            target_amount: null,
          },
        },
        accounts: {
          data: {
            id: "a-credit-null",
            type: "credit",
            current_balance: null,
          },
        },
      }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "goals") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "g-paydown-null", goal_type: "pay_down", starting_balance: null, target_amount: null },
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  is: vi.fn().mockResolvedValue({ error: new Error("Baseline update error") }),
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "a-credit-null", type: "credit", current_balance: null },
                }),
              }),
            }),
          }),
        };
      }),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    };

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: clientNullBal as never,
    });

    const reqNullBal = new NextRequest("http://localhost/api/goals/accounts", {
      method: "POST",
      body: JSON.stringify({
        goalId: "g-paydown-null",
        accountId: "a-credit-null",
        useEntireBalance: true,
      }),
    });
    expect((await goalsAccountPost(reqNullBal)).status).toBe(500);
  });

  it("handles DELETE with unauthorized, missing params, not found, and error", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const reqUnauth = new NextRequest("http://localhost/api/goals/accounts");
    expect((await goalsAccountDelete(reqUnauth)).status).toBe(401);

    const client = clientStub({
      goal_accounts: { data: null }, // not found
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const reqMissing = new NextRequest("http://localhost/api/goals/accounts?goalId=g-1");
    expect((await goalsAccountDelete(reqMissing)).status).toBe(400);

    const reqNotFound = new NextRequest("http://localhost/api/goals/accounts?goalId=g-1&accountId=a-1");
    expect((await goalsAccountDelete(reqNotFound)).status).toBe(404);

    const errClient = clientStub({
      goal_accounts: { error: new Error("DB delete error") },
    });
    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: errClient as never,
    });
    expect((await goalsAccountDelete(reqNotFound)).status).toBe(500);
  });
});
