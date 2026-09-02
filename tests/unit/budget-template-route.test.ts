import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as applyPost } from "@/app/api/budget/templates/apply/route";
import { POST as createPost, DELETE as deleteRoute } from "@/app/api/budget/templates/route";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/http";

const from = vi.fn();

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), getClientIp: vi.fn(() => "127.0.0.1") }));

const TEMPLATE_ID = "11111111-1111-1111-1111-111111111111";

function thenable(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => resolve({ data, error }),
  };
  for (const method of [
    "select", "eq", "order", "limit", "insert", "update", "delete", "single", "maybeSingle", "in",
  ]) {
    builder[method] = () => builder;
  }
  return builder;
}

function request(body: unknown, url = "http://localhost/api/budget/templates"): NextRequest {
  return new NextRequest(url, {
    method: url.includes("apply") ? "POST" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("budget templates routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-123" },
      supabase: { from } as never,
    } as never);
    vi.mocked(writeAudit).mockResolvedValue(undefined);
  });

  it("create validates the item payload and inserts with user_id", async () => {
    const insert = vi.fn(() =>
      thenable([{ id: TEMPLATE_ID, name: "Monthly", items: [{ category: "rent", group_name: "fixed", planned: 1500, rollover_enabled: false }], created_at: "2026-09-02" }]),
    );
    from.mockReturnValue({ insert });
    const res = await createPost(
      request({ name: "Monthly", items: [{ category: "rent", group_name: "fixed", planned: 1500, rollover_enabled: false }] }),
    );
    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-123", name: "Monthly" }),
    );
  });

  it("create rejects an invalid payload before any query", async () => {
    const res = await createPost(request({ name: "", items: [] }));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("apply answers 409 when the month already has envelopes and no mode was sent", async () => {
    from.mockImplementation((table: string) => {
      if (table === "budget_templates") return thenable({ items: [{ category: "rent", group_name: "fixed", planned: 1500, rollover_enabled: false }] });
      if (table === "budgets") return thenable([{ id: "b1", category: "rent" }]);
      if (table === "budget_periods") return thenable([{ budget_id: "b1" }]);
      throw new Error(`unexpected ${table}`);
    });
    const res = await applyPost(request({ template_id: TEMPLATE_ID, month: "2026-09" }, "http://localhost/api/budget/templates/apply"));
    expect(res.status).toBe(409);
  });

  it("apply writes via update_budget_period and audits", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: [{ budget_id: "b1" }], error: null }));
    from.mockImplementation((table: string) => {
      if (table === "budget_templates") return thenable({ items: [{ category: "rent", group_name: "fixed", planned: 1500, rollover_enabled: false }] });
      if (table === "budgets") return thenable([{ id: "b1", category: "rent" }]);
      if (table === "budget_periods") return thenable([]);
      throw new Error(`unexpected ${table}`);
    });
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-123" },
      supabase: { from, rpc } as never,
    } as never);
    const res = await applyPost(request({ template_id: TEMPLATE_ID, month: "2026-09" }, "http://localhost/api/budget/templates/apply"));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "update_budget_period",
      expect.objectContaining({ p_budget_id: "b1", p_month: "2026-09-01", p_planned: 1500 }),
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "budget_template_applied" }),
    );
  });

  it("apply 400s on a bad month before any query", async () => {
    const res = await applyPost(request({ template_id: TEMPLATE_ID, month: "september" }, "http://localhost/api/budget/templates/apply"));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("delete removes only the caller's own template", async () => {
    const builder = thenable([{ id: TEMPLATE_ID }]);
    const del = vi.fn(() => builder);
    from.mockReturnValue({ delete: del });
    const res = await deleteRoute(
      new NextRequest(`http://localhost/api/budget/templates?id=${TEMPLATE_ID}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalled();
  });

  it("returns the auth response when signed out", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await createPost(request({ name: "x", items: [{ category: "rent", group_name: "fixed", planned: 1, rollover_enabled: false }] }));
    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
});
