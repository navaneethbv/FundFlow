import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, type NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (_c: string, e: unknown) =>
    NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 500 }),
  badRequest: (msg: string) => NextResponse.json({ error: msg }, { status: 400 }),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => mockCheckRateLimit() }));

import { POST } from "@/app/api/import/config/route";

function jsonRequest(body: unknown): NextRequest {
  return { json: () => Promise.resolve(body) } as unknown as NextRequest;
}

const MONARCH_BUDGETS = JSON.stringify({
  groups: [
    { name: "Needs", type: "fixed", categories: [{ name: "Rent", amount: 2000 }] },
    { name: "Lifestyle", type: "flexible", categories: [{ name: "Shopping", amount: 400 }] },
  ],
});

const MONARCH_GOALS = JSON.stringify({
  goals: [
    {
      id: "monarch-goal-1",
      name: "Emergency Fund",
      type: "save_up",
      target_amount: 15000,
      target_date: "2027-12-31",
      monthly_contribution: 500,
    },
  ],
});

const MONARCH_GOAL_WITH_ALLOCATION = JSON.stringify({
  goals: [
    {
      id: "monarch-goal-1",
      name: "Emergency Fund",
      type: "save_up",
      target_amount: 15000,
      account_name: "Checking",
      allocation_amount: 4000,
    },
  ],
});

const MONARCH_CUSTOM_BUDGET = JSON.stringify({
  groups: [
    { name: "My custom group", type: "custom", categories: [{ name: "Gifts", amount: 75 }] },
  ],
});

describe("POST /api/import/config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteAudit.mockResolvedValue(undefined);
    mockCheckRateLimit.mockResolvedValue(true);
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: clientStub({}) });
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValueOnce(new NextResponse("Unauthorized", { status: 401 }));
    const res = await POST(jsonRequest({ kind: "budget", text: "{}" }));
    expect(res.status).toBe(401);
  });

  it("validates kind and text", async () => {
    expect((await POST(jsonRequest({ kind: "nope", text: "{}" }))).status).toBe(400);
    expect((await POST(jsonRequest({ kind: "budget" }))).status).toBe(400);
  });

  it("rejects unknown modes and budget decisions before writing", async () => {
    const supabase = clientStub({ budgets: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const badMode = await POST(jsonRequest({
      kind: "budget",
      text: MONARCH_BUDGETS,
      mode: "applies",
    }));
    expect(badMode.status).toBe(400);

    const badDecision = await POST(jsonRequest({
      kind: "budget",
      text: MONARCH_BUDGETS,
      mode: "apply",
      decisions: { Rent: "overwrite" },
    }));
    expect(badDecision.status).toBe(400);
    expect(supabase.writtenTo("budgets")).toBeUndefined();
  });

  it("rejects imports when the rate limit is exhausted or the request body is invalid", async () => {
    mockCheckRateLimit.mockResolvedValueOnce(false);
    expect((await POST(jsonRequest({ kind: "budget", text: MONARCH_BUDGETS }))).status).toBe(429);

    const invalidRequest = { json: () => Promise.reject(new Error("invalid json")) } as unknown as NextRequest;
    expect((await POST(invalidRequest)).status).toBe(400);
  });

  it("fails closed when apply decisions are not an object", async () => {
    const supabase = clientStub({ goals: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await POST(jsonRequest({
      kind: "goal",
      text: MONARCH_GOALS,
      mode: "apply",
      decisions: ["create"],
    }));
    expect(res.status).toBe(400);
    expect(supabase.writtenTo("goals")).toBeUndefined();
  });

  it("returns parser errors for malformed budget and goal exports", async () => {
    expect((await POST(jsonRequest({ kind: "budget", text: JSON.stringify({ groups: [{ categories: [{ name: "Rent", amount: "nope" }] }] }) }))).status).toBe(400);
    expect((await POST(jsonRequest({ kind: "goal", text: JSON.stringify({ goals: [{ name: "" }] }) }))).status).toBe(400);
  });

  it("previews a budget plan without writing", async () => {
    const supabase = clientStub({ budgets: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await POST(jsonRequest({ kind: "budget", text: MONARCH_BUDGETS, mode: "preview" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan.rows).toHaveLength(2);
    expect(body.plan.rows[0]).toMatchObject({ category: "Rent", group: "fixed" });
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("applies a budget import idempotently and audits it", async () => {
    const supabase = clientStub({ budgets: { data: [] }, budget_periods: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const decisions = { Rent: "merge", Shopping: "merge" };
    const res = await POST(jsonRequest({ kind: "budget", text: MONARCH_BUDGETS, mode: "apply", decisions }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, created: 2 });
    expect(supabase.scopedToUser("budgets", "user-1")).toBe(true);
    const inserted = supabase.writtenTo("budgets");
    expect(inserted).toBeDefined();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "budget_config_imported",
        metadata: {
          created_count: 2,
          updated_count: 0,
          skipped_count: 0,
          budget_ids: [],
        },
      }),
    );
  });

  it("skips budget rows the user decided to skip", async () => {
    const supabase = clientStub({ budgets: { data: [] }, budget_periods: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await POST(jsonRequest({ kind: "budget", text: MONARCH_BUDGETS, mode: "apply", decisions: { Rent: "skip", Shopping: "skip" } }));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, created: 0, skipped: 2 });
  });

  it("updates an existing budget and writes its replacement month when requested", async () => {
    const supabase = clientStub({
      budgets: { data: [{ id: "b-1", category: "Rent", monthly_limit: 1500, group_name: "fixed" }] },
      budget_periods: { data: [] },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await POST(jsonRequest({
      kind: "budget",
      text: JSON.stringify({ groups: [{ name: "Needs", type: "fixed", categories: [{ name: "Rent", amount: 2000 }] }] }),
      mode: "apply",
      decisions: { Rent: "replace-month" },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, updated: 1 });
    expect(supabase.callsOn("budget_periods").some(({ method }) => method === "upsert")).toBe(true);
  });

  it("uses the case-insensitive matched budget id for replace-month", async () => {
    const supabase = clientStub({
      budgets: {
        data: [{ id: "b-1", category: "Groceries", monthly_limit: 500, group_name: "flexible" }],
      },
      budget_periods: { data: [] },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await POST(jsonRequest({
      kind: "budget",
      text: JSON.stringify({
        groups: [{ name: "Needs", type: "flexible", categories: [{ name: "groceries", amount: 650 }] }],
      }),
      mode: "apply",
      decisions: { groceries: "replace-month" },
    }));
    expect(res.status).toBe(200);
    expect(supabase.writtenTo("budget_periods")).toMatchObject({
      budget_id: "b-1",
      planned: 650,
    });
    expect(
      supabase.callsOn("budgets").filter(
        ({ method, args }) => method === "eq" && args[0] === "category",
      ),
    ).toHaveLength(0);
  });

  it("keeps the original name of a custom budget group when applying", async () => {
    const supabase = clientStub({ budgets: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await POST(jsonRequest({
      kind: "budget",
      text: MONARCH_CUSTOM_BUDGET,
      mode: "apply",
      decisions: { Gifts: "merge" },
    }));
    expect(res.status).toBe(200);
    expect(supabase.writtenTo("budgets")).toMatchObject({
      category: "Gifts",
      group_name: "My custom group",
    });
  });

  it("previews a goal plan with conflicts and merges into an imported-identifier match", async () => {
    const supabase = clientStub({
      goals: {
        data: [
          {
            id: "g-1",
            name: "Emergency Fund",
            goal_type: "save_up",
            target_amount: 10000,
            target_date: "2028-06-30",
            monthly_contribution: 250,
            import_source: "monarch",
            import_ref: "monarch-goal-1",
          },
        ],
      },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const preview = await POST(jsonRequest({ kind: "goal", text: MONARCH_GOALS, mode: "preview" }));
    const previewBody = await preview.json();
    expect(previewBody.plan.conflicts).toHaveLength(1);
    expect(previewBody.plan.rows[0]).toMatchObject({
      decisionKey: "goal:0",
      matchedGoalId: "g-1",
      defaultDecision: "merge",
      allowedDecisions: ["merge", "replace", "skip"],
    });

    const res = await POST(jsonRequest({ kind: "goal", text: MONARCH_GOALS, mode: "apply" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, updated: 1 });
    expect(supabase.scopedToUser("goals", "user-1")).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      {
        userId: "user-1",
        action: "goal_config_imported",
        metadata: {
          created_count: 0,
          updated_count: 1,
          skipped_count: 0,
          goal_ids: ["g-1"],
          allocation_ids: [],
        },
      },
    );
  });

  it("creates an unmatched goal by default", async () => {
    const supabase = clientStub({ goals: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await POST(jsonRequest({ kind: "goal", text: MONARCH_GOALS, mode: "apply" }));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, created: 1 });
    const inserted = supabase.writtenTo("goals") as Record<string, unknown>;
    expect(inserted).toMatchObject({
      user_id: "user-1",
      import_source: "monarch",
      import_ref: "monarch-goal-1",
      goal_type: "save_up",
    });
  });

  it("applies an imported allocation through the guarded owner-scoped RPC", async () => {
    const supabase = clientStub({
      goals: {
        data: [{
          id: "g-1",
          name: "Emergency Fund",
          goal_type: "save_up",
          target_amount: 10000,
          target_date: null,
          monthly_contribution: null,
          import_source: "monarch",
          import_ref: "monarch-goal-1",
        }],
      },
      accounts: { data: [{ id: "a-1", name: "Checking", type: "depository", current_balance: 5000 }] },
      set_goal_allocation: { data: "allocation-1" },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await POST(jsonRequest({
      kind: "goal",
      text: MONARCH_GOAL_WITH_ALLOCATION,
      mode: "apply",
      decisions: { "goal:0": "merge" },
    }));
    expect(res.status).toBe(200);
    expect(supabase.scopedToUser("accounts", "user-1")).toBe(true);
    expect(supabase.callsOnRpc("set_goal_allocation")).toContainEqual([{
      p_goal_id: "g-1",
      p_account_id: "a-1",
      p_allocated_amount: 4000,
      p_use_entire_balance: false,
    }]);
  });

  it("rejects an imported allocation when its account cannot be resolved", async () => {
    const supabase = clientStub({ goals: { data: [] }, accounts: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await POST(jsonRequest({
      kind: "goal",
      text: MONARCH_GOAL_WITH_ALLOCATION,
      mode: "apply",
      decisions: { "goal:0": "create" },
    }));
    expect(res.status).toBe(400);
    expect(supabase.writtenTo("goals")).toBeUndefined();
  });

  it("rejects allocations without an account and ambiguous account names", async () => {
    const missingAccount = clientStub({ goals: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: missingAccount });
    const missingAccountResponse = await POST(jsonRequest({
      kind: "goal",
      text: JSON.stringify({ goals: [{ name: "Trip", target_amount: 100, allocation_amount: 50 }] }),
      mode: "apply",
      decisions: { "goal:0": "create" },
    }));
    expect(missingAccountResponse.status).toBe(400);

    const ambiguousAccount = clientStub({
      goals: { data: [] },
      accounts: { data: [
        { id: "a-1", name: "Checking", type: "depository", current_balance: 100 },
        { id: "a-2", name: "checking", type: "depository", current_balance: 200 },
      ] },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: ambiguousAccount });
    const ambiguousResponse = await POST(jsonRequest({
      kind: "goal",
      text: MONARCH_GOAL_WITH_ALLOCATION,
      mode: "apply",
      decisions: { "goal:0": "create" },
    }));
    expect(ambiguousResponse.status).toBe(400);
  });

  it("captures a pay-down baseline while applying a whole-account allocation", async () => {
    const supabase = clientStub({
      goals: {
        data: [{
          id: "g-1",
          name: "Card Payoff",
          goal_type: "pay_down",
          target_amount: 3000,
          target_date: null,
          monthly_contribution: null,
          import_source: "monarch",
          import_ref: "monarch-goal-1",
        }],
      },
      accounts: { data: [{ id: "a-1", name: "Card", type: "credit", current_balance: 5000 }] },
      set_goal_allocation: { data: "allocation-1" },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await POST(jsonRequest({
      kind: "goal",
      text: JSON.stringify({ goals: [{ id: "monarch-goal-1", name: "Card Payoff", type: "pay_down", target_amount: 3000, account_name: "Card", use_entire_balance: true }] }),
      mode: "apply",
      decisions: { "goal:0": "merge" },
    }));
    expect(res.status).toBe(200);
    expect(supabase.callsOnRpc("set_goal_allocation")).toContainEqual([{
      p_goal_id: "g-1",
      p_account_id: "a-1",
      p_allocated_amount: null,
      p_use_entire_balance: true,
    }]);
    expect(supabase.callsOn("goals")).toContainEqual(expect.objectContaining({
      method: "update",
      args: [expect.objectContaining({ starting_balance: 5000, target_balance: 2000 })],
    }));
  });

  it("fails closed when an unmatched goal has no schema-valid target amount", async () => {
    const supabase = clientStub({ goals: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await POST(jsonRequest({
      kind: "goal",
      text: JSON.stringify({ goals: [{ name: "Unspecified goal", type: "save_up" }] }),
      mode: "apply",
    }));
    expect(res.status).toBe(400);
    expect(supabase.writtenTo("goals")).toBeUndefined();
  });

  it("rejects invalid goal decisions before writing", async () => {
    const unmatched = clientStub({ goals: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: unmatched });
    for (const decision of ["merge", "replace"]) {
      const response = await POST(jsonRequest({
        kind: "goal",
        text: MONARCH_GOALS,
        mode: "apply",
        decisions: { "goal:0": decision },
      }));
      expect(response.status).toBe(400);
    }
    expect(unmatched.writtenTo("goals")).toBeUndefined();

    const matched = clientStub({
      goals: { data: [{
        id: "g-1",
        name: "Emergency Fund",
        goal_type: "save_up",
        target_amount: 10000,
        target_date: null,
        monthly_contribution: null,
        import_source: "monarch",
        import_ref: "monarch-goal-1",
      }] },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: matched });
    const createMatched = await POST(jsonRequest({
      kind: "goal",
      text: MONARCH_GOALS,
      mode: "apply",
      decisions: { "goal:0": "create" },
    }));
    expect(createMatched.status).toBe(400);

    const nameKeyed = await POST(jsonRequest({
      kind: "goal",
      text: MONARCH_GOALS,
      mode: "apply",
      decisions: { "Emergency Fund": "merge" },
    }));
    expect(nameKeyed.status).toBe(400);
  });

  it("allows skip for matched and unmatched goals", async () => {
    const unmatched = clientStub({ goals: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: unmatched });
    const response = await POST(jsonRequest({
      kind: "goal",
      text: MONARCH_GOALS,
      mode: "apply",
      decisions: { "goal:0": "skip" },
    }));
    expect(await response.json()).toMatchObject({ ok: true, skipped: 1 });
    expect(unmatched.writtenTo("goals")).toBeUndefined();
  });

  it("merge preserves omitted fields while replace clears nullable fields", async () => {
    const existingGoal = {
      id: "g-1",
      name: "Emergency Fund",
      goal_type: "save_up",
      target_amount: 10000,
      target_date: "2028-06-30",
      monthly_contribution: 250,
      import_source: "monarch",
      import_ref: "monarch-goal-1",
    };
    const text = JSON.stringify({ goals: [{
      id: "monarch-goal-1",
      name: "Emergency Fund",
      type: "save_up",
    }] });

    const mergeClient = clientStub({ goals: { data: [existingGoal] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: mergeClient });
    expect((await POST(jsonRequest({ kind: "goal", text, mode: "apply" }))).status).toBe(200);
    const mergePayload = mergeClient.writtenTo("goals") as Record<string, unknown>;
    expect(mergePayload).not.toHaveProperty("target_amount");
    expect(mergePayload).not.toHaveProperty("target_date");
    expect(mergePayload).not.toHaveProperty("monthly_contribution");

    const replaceClient = clientStub({ goals: { data: [existingGoal] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: replaceClient });
    expect((await POST(jsonRequest({
      kind: "goal",
      text,
      mode: "apply",
      decisions: { "goal:0": "replace" },
    }))).status).toBe(200);
    expect(replaceClient.writtenTo("goals")).toMatchObject({
      target_amount: 10000,
      target_date: null,
      monthly_contribution: null,
    });
  });
});
