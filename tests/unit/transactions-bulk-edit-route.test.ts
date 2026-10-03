import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const userId = "user-1";
let enabled = true;
let reviewEnabled = true;
let allowed = true;
let currentUser: { id: string } | null = { id: userId };
let supabase = clientStub({});
let service = clientStub({});
const audit = vi.hoisted(() => vi.fn(async () => undefined));
const invalidate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: (flag: string) => flag === "bulkEdit" ? enabled : flag === "transactionReview" ? reviewEnabled : false }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => allowed) }));
vi.mock("@/lib/dashboard-cache", () => ({ invalidateDashboardCache: invalidate }));
vi.mock("@/lib/audit", () => ({ writeAudit: audit, getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => service }));
vi.mock("@/lib/http", () => ({
  requireUser: () => currentUser ? { user: currentUser, supabase } : new NextResponse("Unauthorized", { status: 401 }),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) => NextResponse.json({ error: String(error) }, { status: 500 }),
}));

import { POST } from "@/app/api/transactions/bulk-edit/route";

const id = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/transactions/bulk-edit", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/transactions/bulk-edit", () => {
  beforeEach(() => {
    enabled = true;
    reviewEnabled = true;
    allowed = true;
    currentUser = { id: userId };
    supabase = clientStub({ transactions: { data: [{ id }, { id: id2 }] } });
    service = clientStub({ transaction_annotations: { data: [{ transaction_id: id, note: "n", tags: ["old"], rule_actions: {} }] } });
    vi.clearAllMocks();
  });

  it("fails closed when disabled, unauthenticated, rate limited, or malformed", async () => {
    enabled = false;
    expect((await POST(request({ transaction_ids: [id], action: "tag", value: "x" }))).status).toBe(404);
    enabled = true;
    currentUser = null;
    expect((await POST(request({ transaction_ids: [id], action: "tag", value: "x" }))).status).toBe(401);
    currentUser = { id: userId };
    allowed = false;
    expect((await POST(request({ transaction_ids: [id], action: "tag", value: "x" }))).status).toBe(429);
    allowed = true;
    expect((await POST(request({ transaction_ids: [], action: "tag", value: "x" }))).status).toBe(400);
    expect((await POST(request({ transaction_ids: [id], action: "unknown" }))).status).toBe(400);
    expect((await POST(request({ transaction_ids: [id], action: "tag", value: "" }))).status).toBe(400);
  });

  it("returns zero for ids the cookie-bound ownership query cannot see", async () => {
    supabase = clientStub({ transactions: { data: [] } });
    const response = await POST(request({ transaction_ids: [id], action: "tag", value: "x" }));
    expect(response.status).toBe(200);
    expect((await response.json()).updated).toBe(0);
    expect(supabase.scopedToUser("transactions", userId)).toBe(true);
  });

  it("writes tags, categories, collections, and exclusion effects with an explicit user scope", async () => {
    for (const [action, value] of [["tag", "trip"], ["category", "TRAVEL"], ["collection", "summer"], ["exclude", ""]] as const) {
      service = clientStub({ transaction_annotations: { data: [{ transaction_id: id, note: "n", tags: ["old"], rule_actions: {} }] } });
      const response = await POST(request({ transaction_ids: [id], action, value }));
      expect(response.status).toBe(200);
      expect(service.scopedToUser("transaction_annotations", userId)).toBe(true);
      expect(service.writtenTo("transaction_annotations")).toBeTruthy();
    }
    expect(audit).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith(userId);
  });

  it("uses the atomic review RPC for the reviewed action", async () => {
    const response = await POST(request({ transaction_ids: [id, id2], action: "reviewed", versions: [{ id, version: "2" }, { id: id2, version: "3" }] }));
    expect(response.status).toBe(200);
    expect(service.callsOnRpc("set_transaction_review_state_atomic")).toHaveLength(1);
    expect(service.callsOnRpc("set_transaction_review_state_atomic")[0]?.[0]).toMatchObject({ p_user_id: userId, p_status: "reviewed" });
  });

  it("rejects invalid ids, disabled reviewed actions, and malformed versions", async () => {
    expect((await POST(request({ transaction_ids: ["not-a-uuid"], action: "tag", value: "x" }))).status).toBe(400);
    enabled = false;
    expect((await POST(request({ transaction_ids: [id], action: "reviewed", versions: [] }))).status).toBe(404);
    enabled = true;
    reviewEnabled = false;
    expect((await POST(request({ transaction_ids: [id], action: "reviewed", versions: [] }))).status).toBe(404);
    reviewEnabled = true;
    service = clientStub({ transaction_annotations: { data: null } });
    expect((await POST(request({ transaction_ids: [id], action: "tag", value: "x", versions: [{ id: "bad", version: 2 }] }))).status).toBe(200);
  });

  it("returns a server error when an annotation read or write fails", async () => {
    service = clientStub({ transaction_annotations: { data: null, error: new Error("read failed") } });
    expect((await POST(request({ transaction_ids: [id], action: "tag", value: "x" }))).status).toBe(500);
    service = clientStub({ transaction_annotations: { data: [{ transaction_id: id }], error: null } });
    const original = service.from("transaction_annotations").upsert;
    service.from("transaction_annotations").upsert = vi.fn(() => { throw new Error("write failed"); });
    expect(original).toBeDefined();
    expect((await POST(request({ transaction_ids: [id], action: "category", value: "TRAVEL" }))).status).toBe(500);
  });

  it("reports ownership and review RPC failures", async () => {
    supabase = clientStub({ transactions: { data: null, error: new Error("ownership failed") } });
    expect((await POST(request({ transaction_ids: [id], action: "tag", value: "x" }))).status).toBe(500);
    service = clientStub({ set_transaction_review_state_atomic: { data: null, error: new Error("review failed") } });
    expect((await POST(request({ transaction_ids: [id], action: "reviewed" }))).status).toBe(500);
  });

  it("rejects an invalid JSON body", async () => {
    const invalid = new NextRequest("http://localhost/api/transactions/bulk-edit", { method: "POST", body: "{" });
    expect((await POST(invalid)).status).toBe(400);
  });
});
