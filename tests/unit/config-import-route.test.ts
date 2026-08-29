import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, type NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
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
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => Promise.resolve(true) }));

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

describe("POST /api/import/config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteAudit.mockResolvedValue(undefined);
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
        metadata: expect.objectContaining({ created: ["Rent", "Shopping"] }),
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

    const res = await POST(jsonRequest({ kind: "goal", text: MONARCH_GOALS, mode: "apply", decisions: { "Emergency Fund": "merge" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, updated: 1 });
    expect(supabase.scopedToUser("goals", "user-1")).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "goal_config_imported" }),
    );
  });

  it("creates a goal when no match exists", async () => {
    const supabase = clientStub({ goals: { data: [] } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await POST(jsonRequest({ kind: "goal", text: MONARCH_GOALS, mode: "apply", decisions: { "Emergency Fund": "create" } }));
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
});