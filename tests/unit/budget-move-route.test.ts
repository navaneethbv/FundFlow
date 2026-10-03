import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

let enabled = true;
let currentUser: { id: string } | null = { id: "user-1" };
let allowed = true;
let rpcResult: { data: unknown; error: { code?: string; message?: string } | null } = { data: "move-1", error: null };
const rpc = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => vi.fn(async () => undefined));
const invalidate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: (flag: string) => flag === "budgetMoves" && enabled }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => allowed }));
vi.mock("@/lib/dashboard-cache", () => ({ invalidateDashboardCache: invalidate }));
vi.mock("@/lib/audit", () => ({ writeAudit: audit, getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc }) }));
vi.mock("@/lib/http", () => ({
  requireUser: async () => currentUser ? { user: currentUser, supabase: {} } : new NextResponse("Unauthorized", { status: 401 }),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) => NextResponse.json({ error: String(error) }, { status: 500 }),
}));

import { POST } from "@/app/api/budget/move/route";

const from = "11111111-1111-4111-8111-111111111111";
const to = "22222222-2222-4222-8222-222222222222";
function request(body: unknown): Request {
  return new Request("http://localhost/api/budget/move", { method: "POST", body: JSON.stringify(body) });
}
const valid = { month: "2026-10", from_budget_id: from, to_budget_id: to, amount: 25.5 };

describe("POST /api/budget/move", () => {
  beforeEach(() => {
    enabled = true;
    currentUser = { id: "user-1" };
    allowed = true;
    rpcResult = { data: "move-1", error: null };
    vi.clearAllMocks();
    rpc.mockImplementation(async () => rpcResult);
  });

  it("moves the amount for the caller's month and records an audit", async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("move_budget_amount", {
      p_user_id: "user-1", p_month: "2026-10-01", p_from_budget_id: from, p_to_budget_id: to, p_amount: 25.5,
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", action: "budget_money_moved" }));
    expect(invalidate).toHaveBeenCalledWith("user-1");
  });

  it("is hidden when disabled and requires a signed-in user", async () => {
    enabled = false;
    expect((await POST(request(valid))).status).toBe(404);
    enabled = true;
    currentUser = null;
    expect((await POST(request(valid))).status).toBe(401);
  });

  it("rate limits before touching budgets", async () => {
    allowed = false;
    expect((await POST(request(valid))).status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...valid, month: "2026-13" }],
    [{ ...valid, from_budget_id: "nope" }],
    [{ ...valid, to_budget_id: from }],
    [{ ...valid, amount: 0 }],
    [{ ...valid, amount: 10.001 }],
    [{ ...valid, amount: "10" }],
    [null],
  ])("rejects malformed moves %#", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the RPC's refusals to client errors", async () => {
    rpcResult = { data: null, error: { code: "22023", message: "Not enough planned in the source budget" } };
    const overdraw = await POST(request(valid));
    expect(overdraw.status).toBe(400);
    expect(await overdraw.json()).toEqual({ error: "Not enough planned in the source budget" });
    rpcResult = { data: null, error: { code: "P0002", message: "Budget not found" } };
    expect((await POST(request(valid))).status).toBe(404);
    rpcResult = { data: null, error: { code: "XX000", message: "boom" } };
    expect((await POST(request(valid))).status).toBe(500);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("parseMoveAmount", () => {
  it("accepts positive amounts with at most two decimals", async () => {
    const { parseMoveAmount } = await import("@/components/budget/MoveMoneyButton");
    expect(parseMoveAmount(" 25.50 ")).toBe(25.5);
    expect(parseMoveAmount("100")).toBe(100);
    for (const bad of ["0", "-5", "1.234", "abc", "", "1e3"]) expect(parseMoveAmount(bad)).toBeNull();
  });
});
