import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, type NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (_c: string, e: unknown) =>
    NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 500 }),
  badRequest: (msg: string) => NextResponse.json({ error: msg }, { status: 400 }),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

import { GET, POST, PATCH, DELETE } from "@/app/api/forecasting/life-events/route";

const ID = "11111111-1111-4111-8111-111111111111";

function jsonRequest(body: unknown): NextRequest {
  return { json: () => Promise.resolve(body) } as unknown as NextRequest;
}

describe("life-events route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteAudit.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValueOnce(new NextResponse("Unauthorized", { status: 401 }));
    expect((await GET()).status).toBe(401);
  });

  it("lists the caller's events only", async () => {
    const supabase = clientStub({
      life_events: {
        data: [
          { id: ID, event_type: "child", start_month: 3, amount: 1000, duration_months: 12, label: "Child" },
        ],
      },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await GET();
    const body = await res.json();
    expect(body.events[0]).toMatchObject({ type: "child", startMonth: 3, amount: 1000 });
    expect(supabase.scopedToUser("life_events", "user-1")).toBe(true);
  });

  it("creates an event and audits it, and rejects invalid values", async () => {
    const supabase = clientStub({
      life_events: {
        data: { id: ID, event_type: "home_purchase", start_month: 6, amount: 50000, duration_months: null, label: null },
      },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const created = await POST(jsonRequest({ type: "home_purchase", startMonth: 6, amount: 50000 }));
    expect(created.status).toBe(201);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "life_event_created" }));

    const invalid = await POST(jsonRequest({ type: "lottery", startMonth: 1, amount: 100 }));
    expect(invalid.status).toBe(400);
  });

  it("updates an owned event and rejects edits to other users' events", async () => {
    const supabase = clientStub({
      life_events: {
        data: { id: ID, event_type: "child", start_month: 3, amount: 1200, duration_months: 12, label: "Child" },
      },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await PATCH(jsonRequest({ id: ID, type: "child", startMonth: 3, amount: 1200, durationMonths: 12 }));
    expect(res.status).toBe(200);
    expect(supabase.scopedToUser("life_events", "user-1")).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "life_event_updated" }));

    // Missing owned row → 400, never a cross-user write.
    const other = clientStub({ life_events: { data: null } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-2" }, supabase: other });
    const denied = await PATCH(jsonRequest({ id: ID, type: "child", startMonth: 3, amount: 100, durationMonths: null }));
    expect(denied.status).toBe(400);
  });

  it("deletes an owned event and audits it", async () => {
    const supabase = clientStub({ life_events: { data: { id: ID } } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await DELETE(jsonRequest({ id: ID }));
    expect(res.status).toBe(200);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "life_event_deleted" }));
    expect(supabase.scopedToUser("life_events", "user-1")).toBe(true);
  });
});
describe("life-events route error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces database errors through errorResponse", async () => {
    const supabase = clientStub({ life_events: { data: null, error: new Error("db down") } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await GET();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "db down" });
  });

  it("returns 400 for a malformed PATCH body or unknown id", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: clientStub({}) });
    expect((await PATCH(jsonRequest({ id: "nope", type: "child", startMonth: 1, amount: 10 }))).status).toBe(400);
    expect((await DELETE(jsonRequest({ id: "nope" }))).status).toBe(400);
  });
});
