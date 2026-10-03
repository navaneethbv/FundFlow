import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

let enabled = true;
let currentUser: { id: string } | null = { id: "user-1" };
let supabase = clientStub({});
const audit = vi.hoisted(() => vi.fn(async () => undefined));
const invalidate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: (flag: string) => flag === "undoToasts" ? enabled : false }));
vi.mock("@/lib/dashboard-cache", () => ({ invalidateDashboardCache: invalidate }));
vi.mock("@/lib/audit", () => ({ writeAudit: audit, getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/http", () => ({
  requireUser: () => currentUser ? { user: currentUser, supabase } : new NextResponse("Unauthorized", { status: 401 }),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) => NextResponse.json({ error: String(error) }, { status: 500 }),
}));

import { POST as undoAnnotation } from "@/app/api/transactions/undo-annotation/route";
import { POST as undoOverride } from "@/app/api/transactions/undo-override/route";

const id = "11111111-1111-4111-8111-111111111111";
function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/transactions/undo", { method: "POST", body: JSON.stringify(body) });
}

describe("single-row undo routes", () => {
  beforeEach(() => {
    enabled = true;
    currentUser = { id: "user-1" };
    supabase = clientStub({
      transactions: { data: { id } },
      transaction_annotations: { data: { note: "new", tags: ["trip"], cleared_at: null, display_category: "TRAVEL", cash_flow_classification: "expense", goal_id: null, rule_actions: {} } },
    });
    vi.clearAllMocks();
  });

  it("fails closed when disabled, unauthenticated, malformed, or unowned", async () => {
    enabled = false;
    expect((await undoAnnotation(request({}))).status).toBe(404);
    expect((await undoOverride(request({}))).status).toBe(404);
    enabled = true;
    currentUser = null;
    expect((await undoAnnotation(request({}))).status).toBe(401);
    currentUser = { id: "user-1" };
    expect((await undoAnnotation(request({ transaction_id: "bad" }))).status).toBe(400);
    supabase = clientStub({ transactions: { data: null } });
    expect((await undoOverride(request({ transaction_id: id, expected: { displayCategory: null, cashFlowClassification: null }, restore: { displayCategory: null, cashFlowClassification: null } }))).status).toBe(404);
    supabase = clientStub({ transactions: { data: null } });
    expect((await undoAnnotation(request({ transaction_id: id, expected: { note: "new", tags: ["trip"], cleared: false }, restore: { note: "before", tags: [], cleared: false } }))).status).toBe(404);
  });

  it("refuses stale annotation and override targets", async () => {
    const annotation = await undoAnnotation(request({ transaction_id: id, expected: { note: "old", tags: [], cleared: false }, restore: { note: "before", tags: [], cleared: false } }));
    expect(annotation.status).toBe(409);
    const override = await undoOverride(request({ transaction_id: id, expected: { displayCategory: "OTHER", cashFlowClassification: "expense" }, restore: { displayCategory: null, cashFlowClassification: null } }));
    expect(override.status).toBe(409);
  });

  it("restores matching annotation and override state with owner-scoped writes", async () => {
    const annotation = await undoAnnotation(request({ transaction_id: id, expected: { note: "new", tags: ["trip"], cleared: false }, restore: { note: "before", tags: [], cleared: false } }));
    expect(annotation.status).toBe(200);
    const override = await undoOverride(request({ transaction_id: id, expected: { displayCategory: "TRAVEL", cashFlowClassification: "expense" }, restore: { displayCategory: "FOOD", cashFlowClassification: null } }));
    expect(override.status).toBe(200);
    expect(supabase.scopedToUser("transaction_annotations", "user-1")).toBe(true);
    expect(supabase.writtenTo("transaction_annotations")).toBeTruthy();
    expect(audit).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith("user-1");
  });

  it("writes only the restored annotation columns, never server-only rule actions", async () => {
    const response = await undoAnnotation(request({ transaction_id: id, expected: { note: "new", tags: ["trip"], cleared: false }, restore: { note: "before", tags: [], cleared: false } }));
    expect(response.status).toBe(200);
    expect(Object.keys(supabase.writtenTo("transaction_annotations") as object).sort()).toEqual(["cleared_at", "note", "tags", "transaction_id", "user_id"]);
  });

  it("rejects malformed state and reports query failures", async () => {
    expect((await undoAnnotation(request({ transaction_id: id, expected: {}, restore: {} }))).status).toBe(400);
    expect((await undoAnnotation(request({ transaction_id: id, expected: { note: "new", tags: [1], cleared: false }, restore: { note: "before", tags: [], cleared: false } }))).status).toBe(400);
    expect((await undoOverride(request({ transaction_id: id, expected: { displayCategory: 1, cashFlowClassification: null }, restore: { displayCategory: null, cashFlowClassification: null } }))).status).toBe(400);
    expect((await undoOverride(request({ transaction_id: id, expected: { displayCategory: "x", cashFlowClassification: "other" }, restore: { displayCategory: null, cashFlowClassification: null } }))).status).toBe(400);
    supabase = clientStub({ transactions: { data: { id }, error: new Error("transaction read") } });
    expect((await undoAnnotation(request({ transaction_id: id, expected: { note: "new", tags: ["trip"], cleared: false }, restore: { note: "before", tags: [], cleared: false } }))).status).toBe(500);
    supabase = clientStub({ transactions: { data: { id } }, transaction_annotations: { data: null, error: new Error("annotation read") } });
    expect((await undoOverride(request({ transaction_id: id, expected: { displayCategory: null, cashFlowClassification: null }, restore: { displayCategory: null, cashFlowClassification: null } }))).status).toBe(500);
  });

  it("handles missing annotations, cleared restores, and write failures", async () => {
    supabase = clientStub({ transactions: { data: { id } }, transaction_annotations: { data: null } });
    const annotation = await undoAnnotation(request({ transaction_id: id, expected: { note: "", tags: [], cleared: false }, restore: { note: "before", tags: [], cleared: true } }));
    expect(annotation.status).toBe(200);
    expect((supabase.writtenTo("transaction_annotations") as { cleared_at?: unknown }).cleared_at).toEqual(expect.any(String));

    supabase = clientStub({ transactions: { data: { id } }, transaction_annotations: { data: null } });
    const override = await undoOverride(request({ transaction_id: id, expected: { displayCategory: null, cashFlowClassification: null }, restore: { displayCategory: "FOOD", cashFlowClassification: "income" } }));
    expect(override.status).toBe(200);

    supabase = clientStub({ transactions: { data: { id } }, transaction_annotations: { data: { note: "new", tags: ["trip"], cleared_at: null }, error: null } });
    const annotationTable = supabase.from("transaction_annotations") as unknown as { upsert: (...args: unknown[]) => unknown };
    annotationTable.upsert = vi.fn(() => { throw new Error("annotation write"); });
    expect((await undoAnnotation(request({ transaction_id: id, expected: { note: "new", tags: ["trip"], cleared: false }, restore: { note: "before", tags: [], cleared: false } }))).status).toBe(500);

    supabase = clientStub({ transactions: { data: { id } }, transaction_annotations: { data: { display_category: "TRAVEL", cash_flow_classification: "expense" }, error: null } });
    const overrideTable = supabase.from("transaction_annotations") as unknown as { upsert: (...args: unknown[]) => unknown };
    overrideTable.upsert = vi.fn(() => { throw new Error("override write"); });
    expect((await undoOverride(request({ transaction_id: id, expected: { displayCategory: "TRAVEL", cashFlowClassification: "expense" }, restore: { displayCategory: null, cashFlowClassification: null } }))).status).toBe(500);
  });
});
