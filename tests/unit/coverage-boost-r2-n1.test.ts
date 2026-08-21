import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) =>
    NextResponse.json({ error: String(error) }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(
  () => Promise.resolve(true),
);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

import { POST, DELETE } from "@/app/api/goals/accounts/route";

const AUTH = { user: { id: "u1" } };

function postReq(body: unknown): NextRequest {
  return new NextRequest("https://x.local/api/goals/accounts", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function deleteReq(goalId?: string, accountId?: string): NextRequest {
  const search = new URLSearchParams();
  if (goalId !== undefined) search.set("goalId", goalId);
  if (accountId !== undefined) search.set("accountId", accountId);
  return new NextRequest(`https://x.local/api/goals/accounts?${search.toString()}`, {
    method: "DELETE",
  });
}

describe("POST /api/goals/accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
  });

  it("passes through the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 5 }));
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    mockRequireUser.mockResolvedValue(AUTH);
    mockCheckRateLimit.mockResolvedValue(false);
    const res = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 5 }));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: "Too many requests" });
  });

  it("falls back to null body when json() rejects", async () => {
    mockRequireUser.mockResolvedValue(AUTH);
    const res = await POST(
      new NextRequest("https://x.local/api/goals/accounts", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("goalId is required");
  });

  it("rejects a missing or blank goalId", async () => {
    mockRequireUser.mockResolvedValue(AUTH);
    const res1 = await POST(postReq({ accountId: "a1", allocatedAmount: 5 }));
    expect(res1.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("goalId is required");

    const res2 = await POST(postReq({ goalId: "   ", accountId: "a1", allocatedAmount: 5 }));
    expect(res2.status).toBe(400);
  });

  it("rejects a missing accountId", async () => {
    mockRequireUser.mockResolvedValue(AUTH);
    const res = await POST(postReq({ goalId: "g1", allocatedAmount: 5 }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("accountId is required");
  });

  it("rejects a non-number, non-finite, zero, or negative allocatedAmount", async () => {
    mockRequireUser.mockResolvedValue(AUTH);
    for (const amount of ["10", NaN, 0, -5]) {
      const res = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: amount }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "Enter an amount above zero to allocate.",
      );
    }
  });

  it("rejects useEntireBalance combined with an amount", async () => {
    mockRequireUser.mockResolvedValue(AUTH);
    const res = await POST(
      postReq({ goalId: "g1", accountId: "a1", useEntireBalance: true, allocatedAmount: 5 }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith(
      "Choose either a fixed amount or the account's entire balance, not both.",
    );
  });

  it("returns 404 when the goal or account is not found", async () => {
    mockRequireUser.mockResolvedValue({
      ...AUTH,
      supabase: clientStub({
        goals: { data: null, error: null },
        accounts: { data: { id: "a1", type: "checking", current_balance: 100 }, error: null },
      }),
    });
    const resGoal = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 5 }));
    expect(resGoal.status).toBe(404);
    await expect(resGoal.json()).resolves.toEqual({ error: "Goal not found" });

    mockRequireUser.mockResolvedValue({
      ...AUTH,
      supabase: clientStub({
        goals: { data: { id: "g1", goal_type: "save_up" }, error: null },
        accounts: { data: null, error: null },
      }),
    });
    const resAccount = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 5 }));
    expect(resAccount.status).toBe(404);
    await expect(resAccount.json()).resolves.toEqual({ error: "Account not found" });
  });

  it("maps a known allocation error code to 409", async () => {
    mockRequireUser.mockResolvedValue({
      ...AUTH,
      supabase: clientStub({
        goals: { data: { id: "g1", goal_type: "save_up" }, error: null },
        accounts: { data: { id: "a1", type: "checking", current_balance: 100 }, error: null },
        set_goal_allocation: { data: null, error: { message: "account_already_fully_allocated" } },
      }),
    });
    const res = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 5 }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Another goal already claims this account's entire balance.",
      code: "account_already_fully_allocated",
    });
  });

  it("throws through errorResponse for an unmapped rpc error", async () => {
    mockRequireUser.mockResolvedValue({
      ...AUTH,
      supabase: clientStub({
        goals: { data: { id: "g1", goal_type: "save_up" }, error: null },
        accounts: { data: { id: "a1", type: "checking", current_balance: 100 }, error: null },
        set_goal_allocation: { data: null, error: { message: "network hiccup" } },
      }),
    });
    const res = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 5 }));
    expect(res.status).toBe(500);
  });

  it("treats an rpc error with no message as unmapped", async () => {
    mockRequireUser.mockResolvedValue({
      ...AUTH,
      supabase: clientStub({
        goals: { data: { id: "g1", goal_type: "save_up" }, error: null },
        accounts: { data: { id: "a1", type: "checking", current_balance: 100 }, error: null },
        set_goal_allocation: { data: null, error: {} },
      }),
    });
    const res = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 5 }));
    expect(res.status).toBe(500);
  });

  it("creates a fixed-amount allocation and skips baseline for a save-up goal", async () => {
    const client = clientStub({
      goals: { data: { id: "g1", goal_type: "save_up", starting_balance: null, target_amount: 1000 }, error: null },
      accounts: { data: { id: "a1", type: "checking", current_balance: 500 }, error: null },
      set_goal_allocation: { data: "alloc-1", error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 12.345 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      id: "alloc-1",
      baselineCaptured: false,
    });
    expect(client.rpcs.set_goal_allocation).toBeTruthy();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "goal_allocation_set",
        metadata: expect.objectContaining({ baselineCaptured: false }),
      }),
    );
  });

  it("allocates an account's entire balance when useEntireBalance with no amount", async () => {
    const client = clientStub({
      goals: { data: { id: "g1", goal_type: "save_up", starting_balance: null, target_amount: 1000 }, error: null },
      accounts: { data: { id: "a1", type: "checking", current_balance: 500 }, error: null },
      set_goal_allocation: { data: "alloc-2", error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await POST(
      postReq({ goalId: "g1", accountId: "a1", useEntireBalance: true, allocatedAmount: null }),
    );
    expect(res.status).toBe(200);
    expect(client.rpcs.set_goal_allocation).toBeTruthy();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "goal_allocation_set",
        metadata: expect.objectContaining({ baselineCaptured: false }),
      }),
    );
  });

  it("captures the pay-down baseline on a first liability link", async () => {
    const client = clientStub({
      goals: { data: { id: "g1", goal_type: "pay_down", starting_balance: null, target_amount: 2000 }, error: null },
      accounts: { data: { id: "a1", type: "credit", current_balance: 3000 }, error: null },
      set_goal_allocation: { data: "alloc-3", error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 100 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      id: "alloc-3",
      baselineCaptured: true,
    });
    const update = client.writtenTo("goals");
    expect(update).toEqual({
      starting_balance: 3000,
      target_balance: 1000,
    });
  });

  it("skips baseline when the goal already has a starting balance", async () => {
    mockRequireUser.mockResolvedValue({
      ...AUTH,
      supabase: clientStub({
        goals: { data: { id: "g1", goal_type: "pay_down", starting_balance: 500, target_amount: 2000 }, error: null },
        accounts: { data: { id: "a1", type: "credit", current_balance: 3000 }, error: null },
        set_goal_allocation: { data: "alloc-4", error: null },
      }),
    });
    const res = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 100 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ baselineCaptured: false });
  });

  it("skips baseline when the account is not a liability", async () => {
    mockRequireUser.mockResolvedValue({
      ...AUTH,
      supabase: clientStub({
        goals: { data: { id: "g1", goal_type: "pay_down", starting_balance: null, target_amount: 2000 }, error: null },
        accounts: { data: { id: "a1", type: "checking", current_balance: 3000 }, error: null },
        set_goal_allocation: { data: "alloc-5", error: null },
      }),
    });
    const res = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 100 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ baselineCaptured: false });
  });

  it("zeroes the baseline target when target_amount is unset", async () => {
    const client = clientStub({
      goals: { data: { id: "g1", goal_type: "pay_down", starting_balance: null, target_amount: null }, error: null },
      accounts: { data: { id: "a1", type: "loan", current_balance: null }, error: null },
      set_goal_allocation: { data: "alloc-6", error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 100 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ baselineCaptured: true });
    expect(client.writtenTo("goals")).toEqual({
      starting_balance: 0,
      target_balance: 0,
    });
  });

  it("throws through errorResponse when the baseline update fails", async () => {
    mockRequireUser.mockResolvedValue({
      ...AUTH,
      supabase: clientStub({
        goals: {
          data: { id: "g1", goal_type: "pay_down", starting_balance: null, target_amount: 2000 },
          error: new Error("baseline update failed"),
        },
        accounts: { data: { id: "a1", type: "credit", current_balance: 3000 }, error: null },
        set_goal_allocation: { data: "alloc-7", error: null },
      }),
    });
    const res = await POST(postReq({ goalId: "g1", accountId: "a1", allocatedAmount: 100 }));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/goals/accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await DELETE(deleteReq("g1", "a1"));
    expect(res.status).toBe(401);
  });

  it("rejects when goalId or accountId is missing", async () => {
    mockRequireUser.mockResolvedValue(AUTH);
    const resNoGoal = await DELETE(deleteReq(undefined, "a1"));
    expect(resNoGoal.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("goalId and accountId are required");

    const resNoAccount = await DELETE(deleteReq("g1", undefined));
    expect(resNoAccount.status).toBe(400);

    const resBlank = await DELETE(deleteReq("  ", "  "));
    expect(resBlank.status).toBe(400);
  });

  it("returns 404 when the allocation is not found", async () => {
    mockRequireUser.mockResolvedValue({
      ...AUTH,
      supabase: clientStub({ goal_accounts: { data: null, error: null } }),
    });
    const res = await DELETE(deleteReq("g1", "a1"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Allocation not found" });
  });

  it("throws through errorResponse when the delete fails", async () => {
    mockRequireUser.mockResolvedValue({
      ...AUTH,
      supabase: clientStub({ goal_accounts: { data: null, error: new Error("del failed") } }),
    });
    const res = await DELETE(deleteReq("g1", "a1"));
    expect(res.status).toBe(500);
  });

  it("deletes the allocation and audits", async () => {
    const client = clientStub({
      goal_accounts: { data: { id: "ga-1" }, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await DELETE(deleteReq("g1", "a1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(client.callsOn("goal_accounts").some((c) => c.method === "delete")).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "goal_allocation_removed",
        metadata: expect.objectContaining({ goal_id: "g1", account_id: "a1" }),
      }),
    );
  });
});