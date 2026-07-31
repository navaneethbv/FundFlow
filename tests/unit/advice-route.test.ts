import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) => {
    throw error;
  },
}));

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

const mockWriteAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

import { PATCH } from "@/app/api/advice/route";

const USER_ID = "user-1";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/advice", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceClient = clientStub({
    advice_progress: { data: null, error: null },
    profiles: { data: null, error: null },
  });
  mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: {} });
});

describe("PATCH /api/advice", () => {
  it("returns the auth response when not signed in", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireUser.mockResolvedValue(unauthorized);
    await expect(PATCH(request({ kind: "toggle_task" }))).resolves.toBe(unauthorized);
  });

  it("400s an unknown kind", async () => {
    const res = await PATCH(request({ kind: "nonsense" }));
    expect(res.status).toBe(400);
  });

  describe("toggle_task", () => {
    it("400s an unknown adviceId", async () => {
      const res = await PATCH(
        request({ kind: "toggle_task", adviceId: "ghost", taskId: "t1", completed: true }),
      );
      expect(res.status).toBe(400);
    });

    it("400s a taskId that doesn't belong to the given adviceId", async () => {
      const res = await PATCH(
        request({ kind: "toggle_task", adviceId: "emergency-fund", taskId: "ghost-task", completed: true }),
      );
      expect(res.status).toBe(400);
    });

    it("upserts progress with the item's content version when marking complete", async () => {
      const res = await PATCH(
        request({
          kind: "toggle_task",
          adviceId: "emergency-fund",
          taskId: "compare-savings-to-one-month",
          completed: true,
        }),
      );
      expect(res.status).toBe(200);
      const written = serviceClient.writtenTo("advice_progress") as Record<string, unknown>;
      expect(written).toMatchObject({
        user_id: USER_ID,
        advice_id: "emergency-fund",
        task_id: "compare-savings-to-one-month",
        content_version: 1,
      });
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "advice_task_toggled", metadata: { advice_id: "emergency-fund" } }),
      );
    });

    it("deletes progress scoped to the caller when marking incomplete", async () => {
      const res = await PATCH(
        request({
          kind: "toggle_task",
          adviceId: "emergency-fund",
          taskId: "compare-savings-to-one-month",
          completed: false,
        }),
      );
      expect(res.status).toBe(200);
      expect(serviceClient.scopedToUser("advice_progress", USER_ID)).toBe(true);
    });
  });

  describe("set_priorities", () => {
    it("400s an unknown advice id", async () => {
      const res = await PATCH(request({ kind: "set_priorities", priorities: ["ghost"] }));
      expect(res.status).toBe(400);
    });

    it("saves a deduplicated, validated priority list to profiles", async () => {
      const res = await PATCH(
        request({ kind: "set_priorities", priorities: ["emergency-fund", "emergency-fund", "review-cash-flow"] }),
      );
      expect(res.status).toBe(200);
      expect(serviceClient.writtenTo("profiles")).toEqual({
        advice_priorities: ["emergency-fund", "review-cash-flow"],
      });
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "advice_priorities_updated" }),
      );
    });
  });

  describe("update_profile", () => {
    it("400s an invalid profile shape", async () => {
      const res = await PATCH(request({ kind: "update_profile", profile: { ssn: "123" } }));
      expect(res.status).toBe(400);
    });

    it("saves a valid profile and never puts its contents in the audit log", async () => {
      const res = await PATCH(
        request({ kind: "update_profile", profile: { hasDependents: true, homeownership: "rent" } }),
      );
      expect(res.status).toBe(200);
      expect(serviceClient.writtenTo("profiles")).toEqual({
        advice_profile: { hasDependents: true, homeownership: "rent" },
      });
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "advice_profile_updated", metadata: {} }),
      );
    });

    it("clears saved answers when profile is null", async () => {
      const res = await PATCH(request({ kind: "update_profile", profile: null }));
      expect(res.status).toBe(200);
      expect(serviceClient.writtenTo("profiles")).toEqual({ advice_profile: null });
    });
  });
});
