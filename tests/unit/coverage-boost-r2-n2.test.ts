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

const mockGoalContributionRecorded = vi.fn<(...args: unknown[]) => unknown>();
const mockGoalContributionRemoved = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/request-audit", () => ({
  requestAudits: {
    goalContributionRecorded: (...args: unknown[]) =>
      mockGoalContributionRecorded(...args),
    goalContributionRemoved: (...args: unknown[]) =>
      mockGoalContributionRemoved(...args),
  },
}));

vi.mock("@/lib/reports", () => ({
  isIsoDate: (value: unknown) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
}));

import { POST, DELETE } from "@/app/api/goals/events/route";

function postReq(body: unknown): NextRequest {
  return new NextRequest("https://x.local/api/goals/events", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function deleteReq(id?: string): NextRequest {
  const search = new URLSearchParams();
  if (id !== undefined) search.set("id", id);
  return new NextRequest(`https://x.local/api/goals/events?${search.toString()}`, {
    method: "DELETE",
  });
}

describe("POST /api/goals/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
  });

  it("passes through the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await POST(postReq({ goalId: "g1", amount: 5 }));
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    mockCheckRateLimit.mockResolvedValue(false);
    const res = await POST(postReq({ goalId: "g1", amount: 5 }));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: "Too many requests" });
  });

  it("falls back to null body when json() rejects", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(
      new NextRequest("https://x.local/api/goals/events", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("goalId is required");
  });

  it("rejects a missing, blank, or non-string goalId", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    for (const body of [
      { amount: 5 },
      { goalId: "   ", amount: 5 },
      { goalId: 42, amount: 5 },
    ]) {
      const res = await POST(postReq(body));
      expect(res.status).toBe(400);
    }
  });

  it("rejects a non-number, non-finite, zero, or oversized amount", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    for (const amount of ["10", NaN, 0, 2_000_000_000]) {
      const res = await POST(postReq({ goalId: "g1", amount }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("amount must be a non-zero number");
    }
  });

  it("defaults an unknown or missing eventType to manual_contribution", async () => {
    const client = clientStub({
      goals: { data: { id: "g1" }, error: null },
      goal_progress_events: { data: { id: "evt-1" }, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });

    const resUnknown = await POST(
      postReq({ goalId: "g1", amount: 5, eventType: "bogus_type" }),
    );
    expect(resUnknown.status).toBe(200);
    expect(client.writtenTo("goal_progress_events")).toMatchObject({
      event_type: "manual_contribution",
    });

    const resMissing = await POST(postReq({ goalId: "g1", amount: 5 }));
    expect(resMissing.status).toBe(200);
    expect(mockGoalContributionRecorded).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      { goal_id: "g1", event_type: "manual_contribution" },
    );
  });

  it("records a manual_adjustment event with an explicit ISO date", async () => {
    const client = clientStub({
      goals: { data: { id: "g1" }, error: null },
      goal_progress_events: { data: { id: "evt-2" }, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await POST(
      postReq({ goalId: "g1", amount: -12.5, eventDate: "2026-07-15", eventType: "manual_adjustment" }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, id: "evt-2" });
    expect(client.writtenTo("goal_progress_events")).toMatchObject({
      goal_id: "g1",
      event_date: "2026-07-15",
      amount: -12.5,
      event_type: "manual_adjustment",
    });
  });

  it("defaults the event date to today when not a valid ISO date", async () => {
    const client = clientStub({
      goals: { data: { id: "g1" }, error: null },
      goal_progress_events: { data: { id: "evt-3" }, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await POST(postReq({ goalId: "g1", amount: 5, eventDate: "not-a-date" }));
    expect(res.status).toBe(200);
    expect(client.writtenTo("goal_progress_events")).toMatchObject({
      event_date: new Date().toISOString().slice(0, 10),
    });
  });

  it("returns 404 when the goal is not found", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ goals: { data: null, error: null } }),
    });
    const res = await POST(postReq({ goalId: "g1", amount: 5 }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Goal not found" });
  });

  it("throws through errorResponse when the insert fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        goals: { data: { id: "g1" }, error: null },
        goal_progress_events: { data: null, error: new Error("insert failed") },
      }),
    });
    const res = await POST(postReq({ goalId: "g1", amount: 5 }));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/goals/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await DELETE(deleteReq("evt-1"));
    expect(res.status).toBe(401);
  });

  it("rejects a missing id", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const res = await DELETE(deleteReq(undefined));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("id is required");
  });

  it("returns 404 when the event is not found", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ goal_progress_events: { data: null, error: null } }),
    });
    const res = await DELETE(deleteReq("evt-missing"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Event not found" });
  });

  it("throws through errorResponse when the delete fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        goal_progress_events: { data: null, error: new Error("delete failed") },
      }),
    });
    const res = await DELETE(deleteReq("evt-1"));
    expect(res.status).toBe(500);
  });

  it("deletes the event and audits", async () => {
    const client = clientStub({
      goal_progress_events: { data: { id: "evt-1" }, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await DELETE(deleteReq("evt-1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(client.callsOn("goal_progress_events").some((c) => c.method === "delete")).toBe(true);
    expect(mockGoalContributionRemoved).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      { event_id: "evt-1" },
    );
  });
});