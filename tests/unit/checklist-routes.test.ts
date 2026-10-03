import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  flags: new Set<string>(),
  auth: vi.fn(),
  rpc: vi.fn(),
  audit: vi.fn(),
  rateLimit: vi.fn(),
  privateData: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (flag: string) => state.flags.has(flag),
}));
vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: () => state.auth() };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...args: unknown[]) => state.rateLimit(...args) }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc: state.rpc }),
}));
vi.mock("@/lib/private-lending-data", () => ({
  loadPrivateLendingData: (...args: unknown[]) => state.privateData(...args),
}));
vi.mock("@/lib/audit", () => ({
  getClientIp: () => "127.0.0.1",
  writeAudit: (input: unknown) => state.audit(input),
}));
vi.mock("@/lib/report-period", () => ({ resolveViewerToday: vi.fn().mockResolvedValue("2026-10-07") }));

import { POST as undoImport } from "@/app/api/import/undo/route";
import { GET as privateLendingGet, POST as privateLending } from "@/app/api/private-lending/route";
import { POST as completeWeeklyReview } from "@/app/api/review/weekly/complete/route";

const user = { user: { id: "00000000-0000-4000-8000-000000000001" } };

function request(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  state.flags.clear();
  state.auth.mockReset();
  state.rpc.mockReset();
  state.audit.mockReset();
  state.rateLimit.mockReset();
  state.privateData.mockReset();
  state.auth.mockResolvedValue(user);
  state.rateLimit.mockResolvedValue(true);
  state.privateData.mockResolvedValue({ loans: [], summary: { receivable: 0, payable: 0, netWorthAdjustment: 0 } });
  state.rpc.mockResolvedValue({ data: { status: "undone", deleted: 1 }, error: null });
});

describe("guarded import undo route", () => {
  it("hides the route when either prerequisite flag is off", async () => {
    expect((await undoImport(request("/api/import/undo", { batch_id: "00000000-0000-4000-8000-000000000001" }))).status).toBe(404);
    state.flags.add("importUndo");
    expect((await undoImport(request("/api/import/undo", { batch_id: "00000000-0000-4000-8000-000000000001" }))).status).toBe(404);
  });

  it("maps a guarded refusal to a conflict and audits successful undo", async () => {
    state.flags.add("importUndo");
    state.flags.add("importHistory");
    state.rpc.mockResolvedValueOnce({ data: { status: "refused", reason: "A later edit depends on this import." }, error: null });
    expect((await undoImport(request("/api/import/undo", { batch_id: "00000000-0000-4000-8000-000000000001" }))).status).toBe(409);
    state.rpc.mockResolvedValueOnce({ data: { status: "undone", deleted: 2 }, error: null });
    const response = await undoImport(request("/api/import/undo", { batch_id: "00000000-0000-4000-8000-000000000001" }));
    expect(response.status).toBe(200);
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "import_undone" }));
  });

  it("validates identifiers, rate limits attempts, and maps service failures", async () => {
    state.flags.add("importUndo");
    state.flags.add("importHistory");
    expect((await undoImport(request("/api/import/undo", { batch_id: "not-a-uuid" }))).status).toBe(400);
    state.rateLimit.mockResolvedValueOnce(false);
    expect((await undoImport(request("/api/import/undo", { batch_id: "00000000-0000-4000-8000-000000000001" }))).status).toBe(429);
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "missing" } });
    expect((await undoImport(request("/api/import/undo", { batch_id: "00000000-0000-4000-8000-000000000001" }))).status).toBe(404);
    state.rpc.mockResolvedValueOnce({ data: null, error: new Error("service down") });
    expect((await undoImport(request("/api/import/undo", { batch_id: "00000000-0000-4000-8000-000000000001" }))).status).toBe(500);
  });
});

describe("private lending route", () => {
  it("validates loan drafts before calling the service RPC", async () => {
    state.flags.add("privateLending");
    const response = await privateLending(request("/api/private-lending", { kind: "loan", direction: "lent", counterparty: "", principal: 10, startDate: "2026-10-01" }));
    expect(response.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("creates a valid loan and records a payment not-found response", async () => {
    state.flags.add("privateLending");
    state.rpc.mockResolvedValueOnce({ data: "loan-id", error: null });
    const created = await privateLending(request("/api/private-lending", {
      kind: "loan", direction: "lent", counterparty: "Sam", principal: 100, annualInterestRate: 5, startDate: "2026-10-01",
    }));
    expect(created.status).toBe(200);
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "private_loan_created" }));
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "missing" } });
    const missing = await privateLending(request("/api/private-lending", {
      kind: "payment", loan_id: "00000000-0000-4000-8000-000000000002", amount: 10, payment_date: "2026-10-02",
    }));
    expect(missing.status).toBe(404);
  });

  it("routes a failed lending RPC through the error response instead of rejecting", async () => {
    state.flags.add("privateLending");
    state.rpc.mockResolvedValueOnce({ data: null, error: new Error("insert failed") });
    const created = await privateLending(request("/api/private-lending", {
      kind: "loan", direction: "lent", counterparty: "Sam", principal: 100, annualInterestRate: 5, startDate: "2026-10-01",
    }));
    expect(created.status).toBe(500);
    state.rpc.mockResolvedValueOnce({ data: null, error: new Error("payment failed") });
    const paid = await privateLending(request("/api/private-lending", {
      kind: "payment", loan_id: "00000000-0000-4000-8000-000000000002", amount: 10, payment_date: "2026-10-02",
    }));
    expect(paid.status).toBe(500);
  });

  it("serves private lending data and validates payment branches", async () => {
    state.flags.add("privateLending");
    const getResponse = await privateLendingGet();
    expect(getResponse.status).toBe(200);
    expect(state.privateData).toHaveBeenCalledWith(undefined, user.user.id, "2026-10-07");
    expect((await privateLending(request("/api/private-lending", { kind: "payment", loan_id: "bad", payment_date: "2026-10-02", amount: 10 }))).status).toBe(400);
    expect((await privateLending(request("/api/private-lending", { kind: "payment", loan_id: "00000000-0000-4000-8000-000000000002", payment_date: "2026-10-02", amount: 0 }))).status).toBe(400);
    expect((await privateLending(request("/api/private-lending", { kind: "payment", loan_id: "00000000-0000-4000-8000-000000000002", payment_date: "2026-10-02", amount: 10, note: "x".repeat(501) }))).status).toBe(400);
    state.rpc.mockResolvedValueOnce({ data: { remaining: 5 }, error: null });
    const recorded = await privateLending(request("/api/private-lending", { kind: "payment", loan_id: "00000000-0000-4000-8000-000000000002", amount: 10, payment_date: "2026-10-02", note: "paid" }));
    expect(recorded.status).toBe(200);
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "private_loan_payment_recorded" }));
    expect((await privateLending(request("/api/private-lending", { kind: "other" }))).status).toBe(400);
    expect((await privateLending(request("/api/private-lending", { kind: "payment", loan_id: "00000000-0000-4000-8000-000000000002", payment_date: "2026-02-31", amount: 10 }))).status).toBe(400);
    state.rateLimit.mockResolvedValueOnce(false);
    expect((await privateLending(request("/api/private-lending", { kind: "other" }))).status).toBe(429);
  });
});

describe("weekly review completion route", () => {
  it("requires the feature and an explicit completion payload", async () => {
    const hidden = await completeWeeklyReview(request("/api/review/weekly/complete", { complete: true }));
    expect(hidden.status).toBe(404);
    state.flags.add("weeklyReview");
    const invalid = await completeWeeklyReview(request("/api/review/weekly/complete", { complete: false }));
    expect(invalid.status).toBe(400);
  });

  it("completes and audits the viewer's Monday week", async () => {
    state.flags.add("weeklyReview");
    state.rpc.mockResolvedValue({ data: { weekStart: "2026-10-05", streak: 3 }, error: null });
    const response = await completeWeeklyReview(request("/api/review/weekly/complete", { complete: true }));
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("complete_weekly_review", expect.objectContaining({ p_week_start: "2026-10-05" }));
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "weekly_review_completed" }));
  });

  it("maps completion service errors and rate limits", async () => {
    state.flags.add("weeklyReview");
    state.rateLimit.mockResolvedValueOnce(false);
    expect((await completeWeeklyReview(request("/api/review/weekly/complete", { complete: true }))).status).toBe(429);
    state.rpc.mockResolvedValueOnce({ data: null, error: new Error("completion failed") });
    expect((await completeWeeklyReview(request("/api/review/weekly/complete", { complete: true }))).status).toBe(500);
  });
});
