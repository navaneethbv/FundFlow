import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "@/app/api/recurring/price-changes/route";
import { requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { clientStub } from "../fixtures/supabase-query";

const featureEnabled = vi.hoisted(() => vi.fn(() => true));
const serviceClient = vi.hoisted(() => ({ current: null as ReturnType<typeof clientStub> | null }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: featureEnabled }));
vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), getClientIp: vi.fn(() => "127.0.0.1") }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(() => serviceClient.current) }));

const STREAM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user-1";

function request(body: unknown): NextRequest {
  return new NextRequest("https://app.test/api/recurring/price-changes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authenticated(client: ReturnType<typeof clientStub>) {
  vi.mocked(requireUser).mockResolvedValue({ user: { id: USER_ID }, supabase: client as never } as never);
}

describe("recurring price changes routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureEnabled.mockReturnValue(true);
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.mocked(writeAudit).mockResolvedValue(undefined);
    serviceClient.current = clientStub({ recurring_price_changes: { data: null, error: null } });
  });

  it("returns 404 for both methods while the feature is off", async () => {
    featureEnabled.mockReturnValue(false);
    expect((await GET()).status).toBe(404);
    expect((await POST(request({ stream_id: STREAM_ID }))).status).toBe(404);
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("returns the auth response and rate-limits sensitive writes", async () => {
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never);
    expect((await GET()).status).toBe(401);
    vi.mocked(requireUser).mockResolvedValue({ user: { id: USER_ID }, supabase: clientStub() as never } as never);
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect((await POST(request({ stream_id: STREAM_ID }))).status).toBe(429);
  });

  it("lists only the caller's recorded changes", async () => {
    const client = clientStub({ recurring_price_changes: { data: [{ id: "change" }], error: null } });
    authenticated(client);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ changes: [{ id: "change" }] });
    expect(client.scopedToUser("recurring_price_changes", USER_ID)).toBe(true);
  });

  it("returns an error response when the history list fails", async () => {
    const client = clientStub({ recurring_price_changes: { data: null, error: { message: "list failed" } } });
    authenticated(client);
    expect((await GET()).status).toBe(500);
  });

  it("rejects malformed stream ids before querying", async () => {
    const client = clientStub();
    authenticated(client);
    const response = await POST(request({ stream_id: "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns not found when the stream is not owned by the caller", async () => {
    const client = clientStub({ recurring_streams: { data: null, error: null } });
    authenticated(client);
    expect((await POST(request({ stream_id: STREAM_ID }))).status).toBe(404);
  });

  it("handles linked-history and transaction query failures", async () => {
    const joinFailure = clientStub({
      recurring_streams: { data: { id: STREAM_ID }, error: null },
      recurring_stream_transactions: { data: null, error: { message: "join failed" } },
    });
    authenticated(joinFailure);
    expect((await POST(request({ stream_id: STREAM_ID }))).status).toBe(500);

    const transactionFailure = clientStub({
      recurring_streams: { data: { id: STREAM_ID }, error: null },
      recurring_stream_transactions: { data: [{ transaction_id: "t1" }, { transaction_id: "t2" }, { transaction_id: "t3" }], error: null },
      transactions: { data: null, error: { message: "transaction failed" } },
    });
    authenticated(transactionFailure);
    expect((await POST(request({ stream_id: STREAM_ID }))).status).toBe(500);
  });

  it("leaves an unconfirmed amount change as a review result", async () => {
    const client = clientStub({
      recurring_streams: { data: { id: STREAM_ID }, error: null },
      recurring_stream_transactions: { data: [{ transaction_id: "t1" }, { transaction_id: "t2" }, { transaction_id: "t3" }], error: null },
      transactions: { data: [
        { id: "t1", date: "2026-01-01", amount: 10 },
        { id: "t2", date: "2026-02-01", amount: 11 },
        { id: "t3", date: "2026-03-01", amount: 12 },
      ], error: null },
    });
    authenticated(client);
    await expect((await POST(request({ stream_id: STREAM_ID }))).json()).resolves.toEqual({ recorded: false, reason: "not_confirmed" });
  });

  it("reports insufficient history without recording a change", async () => {
    const client = clientStub({
      recurring_streams: { data: { id: STREAM_ID }, error: null },
      recurring_stream_transactions: { data: [{ transaction_id: "t1" }, { transaction_id: "t2" }], error: null },
    });
    authenticated(client);
    const response = await POST(request({ stream_id: STREAM_ID }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ recorded: false, reason: "insufficient_history" });
    expect(serviceClient.current?.writtenTo("recurring_price_changes")).toBeUndefined();
  });

  it("records a confirmed increase with explicit user scope", async () => {
    const client = clientStub({
      recurring_streams: { data: { id: STREAM_ID }, error: null },
      recurring_stream_transactions: { data: [{ transaction_id: "t1" }, { transaction_id: "t2" }, { transaction_id: "t3" }], error: null },
      transactions: { data: [
        { id: "t1", date: "2026-01-01", amount: 10 },
        { id: "t2", date: "2026-02-01", amount: 12 },
        { id: "t3", date: "2026-03-01", amount: 12 },
      ], error: null },
    });
    authenticated(client);
    const response = await POST(request({ stream_id: STREAM_ID }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ recorded: true, change: { previousAmount: 10, newAmount: 12 } });
    expect(serviceClient.current?.writtenTo("recurring_price_changes")).toMatchObject({ user_id: USER_ID, recurring_stream_id: STREAM_ID, effective_date: "2026-02-01" });
    expect(serviceClient.current?.scopedToUser("recurring_price_changes", USER_ID)).toBe(true);
    expect(client.scopedToUser("transactions", USER_ID)).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "recurring_price_change_recorded", userId: USER_ID }));
  });

  it("does not duplicate a previously recorded effective change", async () => {
    const client = clientStub({
      recurring_streams: { data: { id: STREAM_ID }, error: null },
      recurring_stream_transactions: { data: [{ transaction_id: "t1" }, { transaction_id: "t2" }, { transaction_id: "t3" }], error: null },
      transactions: { data: [
        { id: "t1", date: "2026-01-01", amount: 10 },
        { id: "t2", date: "2026-02-01", amount: 12 },
        { id: "t3", date: "2026-03-01", amount: 12 },
      ], error: null },
    });
    serviceClient.current = clientStub({ recurring_price_changes: { data: { id: "existing" }, error: null } });
    authenticated(client);
    await expect((await POST(request({ stream_id: STREAM_ID }))).json()).resolves.toEqual({ recorded: false, reason: "already_recorded" });
  });

  it("returns a safe error when the service history check fails", async () => {
    const client = clientStub({
      recurring_streams: { data: { id: STREAM_ID }, error: null },
      recurring_stream_transactions: { data: [{ transaction_id: "t1" }, { transaction_id: "t2" }, { transaction_id: "t3" }], error: null },
      transactions: { data: [
        { id: "t1", date: "2026-01-01", amount: 10 },
        { id: "t2", date: "2026-02-01", amount: 12 },
        { id: "t3", date: "2026-03-01", amount: 12 },
      ], error: null },
    });
    serviceClient.current = clientStub({ recurring_price_changes: { data: null, error: { message: "service failed" } } });
    authenticated(client);
    expect((await POST(request({ stream_id: STREAM_ID }))).status).toBe(500);
  });
});
