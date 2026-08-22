import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockBadRequest = vi.fn((message: string) =>
  NextResponse.json({ error: message }, { status: 400 }),
);
const mockErrorResponse = vi.fn((_context: string, error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : "error" },
    { status: 500 },
  ),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (...a: unknown[]) => mockBadRequest(...(a as [string])),
  errorResponse: (context: string, error: unknown) => mockErrorResponse(context, error),
}));

const mockWriteAudit = vi.fn();
const mockGetClientIp = vi.fn(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => mockGetClientIp(),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => Promise<boolean>>(
  () => Promise.resolve(true),
);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

let serviceClient: { from: ReturnType<typeof vi.fn> } = { from: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

let appUrl: string | undefined = "https://app.example.com";
vi.mock("@/lib/env.server", () => ({
  get serverEnv() {
    return { appUrl };
  },
}));

const mockSendHouseholdInviteEmail = vi.fn();
vi.mock("@/lib/reporting", () => ({
  sendHouseholdInviteEmail: (...args: unknown[]) =>
    mockSendHouseholdInviteEmail(...args),
}));

import { PATCH as recurringPatch } from "@/app/api/recurring/route";
import {
  POST as recurringManualPost,
  PATCH as recurringManualPatch,
  DELETE as recurringManualDelete,
} from "@/app/api/recurring/manual/route";
import { GET as householdAcceptGet } from "@/app/api/household/accept/route";
import { POST as householdInvitePost } from "@/app/api/household/invite/route";

const USER = { id: "u1", email: "me@example.com" };
const UUID = "12345678-1234-1234-1234-123456789012";

function chainable(result: () => unknown) {
  const o: Record<string, unknown> = {};
  for (const m of [
    "select", "eq", "neq", "in", "limit", "order", "maybeSingle", "single",
    "insert", "update", "upsert", "delete", "is",
  ]) {
    o[m] = () => o;
  }
  (o as { then: unknown }).then = (
    onf: (v: unknown) => unknown,
    onr?: (e: unknown) => unknown,
  ) => Promise.resolve(result()).then(onf, onr);
  return o;
}

function supabase(handlers: Record<string, () => unknown> = {}) {
  return {
    from: vi.fn((table: string) =>
      chainable(handlers[table] ?? (() => ({ data: null, error: null }))),
    ),
  };
}

function jsonRequest(body: unknown) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteAudit.mockReset();
  mockWriteAudit.mockResolvedValue(undefined);
  mockCheckRateLimit.mockResolvedValue(true);
  appUrl = "https://app.example.com";
  serviceClient = { from: vi.fn() };
  mockRequireUser.mockResolvedValue({ user: USER, supabase: supabase({}) });
});

describe("PATCH /api/recurring", () => {
  function svc(result: () => unknown) {
    return { from: vi.fn(() => chainable(result)) };
  }

  it("returns 401 when unauthenticated (line 68 branch)", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    const res = await recurringPatch(jsonRequest({ stream_id: UUID, action: "review" }));
    expect(res.status).toBe(401);
  });

  it("returns bad request for an invalid JSON payload (line 28/29)", async () => {
    const res = await recurringPatch(jsonRequest(null));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON payload");
  });

  it("returns bad request for an invalid stream_id", async () => {
    const res = await recurringPatch(jsonRequest({ stream_id: "nope", action: "review" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid stream_id");
  });

  it("returns bad request for an invalid action", async () => {
    const res = await recurringPatch(jsonRequest({ stream_id: UUID, action: "nope" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid action");
  });

  it("returns bad request for an invalid correct_amount", async () => {
    const res = await recurringPatch(
      jsonRequest({ stream_id: UUID, action: "correct_amount", amount: -5 }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid amount");
  });

  it("returns 500 when the service update errors (line 93 branch)", async () => {
    serviceClient = svc(() => ({ data: null, error: new Error("update fail") }));
    const res = await recurringPatch(jsonRequest({ stream_id: UUID, action: "review" }));
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("recurring.update", expect.any(Error));
  });

  it("returns 404 when no stream is returned (line 94/95)", async () => {
    serviceClient = svc(() => ({ data: null, error: null }));
    const res = await recurringPatch(jsonRequest({ stream_id: UUID, action: "review" }));
    expect(res.status).toBe(404);
  });

  it("applies each action successfully", async () => {
    serviceClient = svc(() => ({ data: { id: UUID }, error: null }));
    for (const action of ["review", "dismiss", "restore", "correct_amount"]) {
      const body =
        action === "correct_amount"
          ? { stream_id: UUID, action, amount: 12.5 }
          : { stream_id: UUID, action };
      const res = await recurringPatch(jsonRequest(body));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ stream_id: UUID, action });
    }
  });

  it("returns 500 when the audit throws (line 106 catch)", async () => {
    serviceClient = svc(() => ({ data: { id: UUID }, error: null }));
    mockWriteAudit.mockRejectedValue(new Error("audit fail"));
    const res = await recurringPatch(jsonRequest({ stream_id: UUID, action: "review" }));
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("recurring.update", expect.any(Error));
  });
});

describe("POST /api/recurring/manual", () => {
  function validCreate() {
    return {
      name: "Rent",
      amount: 1200,
      frequency: "monthly",
      next_date: "2026-09-01",
      item_type: "expense",
      category: "Housing",
    };
  }

  it("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    const res = await recurringManualPost(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns bad request when create is invalid", async () => {
    const res = await recurringManualPost(jsonRequest({ name: "" }));
    expect(res.status).toBe(400);
  });

  it("creates an item and audits (line 60 parser covered)", async () => {
    const chain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "mi1" }, error: null }),
    };
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: { from: vi.fn(() => chain) },
    });
    const res = await recurringManualPost(jsonRequest(validCreate()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: "mi1" });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_recurring_item_created" }),
    );
  });

  it("returns 500 when the insert throws (line 149 catch)", async () => {
    const chain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockRejectedValue(new Error("insert reject")),
    };
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: { from: vi.fn(() => chain) },
    });
    const res = await recurringManualPost(jsonRequest(validCreate()));
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("recurring.manual.create", expect.any(Error));
  });

  it("returns 500 when the insert returns an error", async () => {
    const chain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: new Error("insert err") }),
    };
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: { from: vi.fn(() => chain) },
    });
    const res = await recurringManualPost(jsonRequest(validCreate()));
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/recurring/manual", () => {
  function patchSupabase(result: () => unknown) {
    const chain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(result())),
    };
    return { from: vi.fn(() => chain) };
  }

  it("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    const res = await recurringManualPatch(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns bad request when body is null", async () => {
    const res = await recurringManualPatch(jsonRequest(null));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON payload");
  });

  it("returns bad request for an invalid id", async () => {
    const res = await recurringManualPatch(jsonRequest({ id: "bad" }));
    expect(res.status).toBe(400);
  });

  it("returns bad request for an invalid name (line 57 branch)", async () => {
    const res = await recurringManualPatch(jsonRequest({ id: UUID, name: "" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid name");
  });

  it("returns bad request for an invalid amount", async () => {
    const res = await recurringManualPatch(jsonRequest({ id: UUID, amount: -1 }));
    expect(res.status).toBe(400);
  });

  it("returns bad request for an invalid frequency (line 70 branch)", async () => {
    const res = await recurringManualPatch(jsonRequest({ id: UUID, frequency: "daily" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid frequency");
  });

  it("returns bad request for an invalid next_date (line 76 branch)", async () => {
    const res = await recurringManualPatch(jsonRequest({ id: UUID, next_date: "bad" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid next_date");
  });

  it("returns bad request for an invalid item_type (line 82 branch)", async () => {
    const res = await recurringManualPatch(jsonRequest({ id: UUID, item_type: "bad" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid item_type");
  });

  it("returns bad request for an invalid category (line 88 branch)", async () => {
    const res = await recurringManualPatch(jsonRequest({ id: UUID, category: 5 }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid category");
  });

  it("returns bad request for an invalid enabled (line 94 branch)", async () => {
    const res = await recurringManualPatch(jsonRequest({ id: UUID, enabled: "yes" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid enabled");
  });

  it("updates with all valid fields (all valid parser branches + line 60)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: patchSupabase(() => ({ data: { id: UUID }, error: null })),
    });
    const res = await recurringManualPatch(
      jsonRequest({
        id: UUID,
        name: "Rent",
        amount: 1200,
        frequency: "monthly",
        next_date: "2026-09-01",
        item_type: "expense",
        category: "Housing",
        enabled: true,
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: UUID });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_recurring_item_updated" }),
    );
  });

  it("returns 404 when the item is not found", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: patchSupabase(() => ({ data: null, error: null })),
    });
    const res = await recurringManualPatch(jsonRequest({ id: UUID, name: "Rent" }));
    expect(res.status).toBe(404);
  });

  it("returns 500 when the update throws (line 183 catch)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: patchSupabase(() => Promise.reject(new Error("update reject"))),
    });
    const res = await recurringManualPatch(jsonRequest({ id: UUID, name: "Rent" }));
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("recurring.manual.update", expect.any(Error));
  });
});

describe("DELETE /api/recurring/manual", () => {
  function delSupabase(result: () => unknown) {
    return { from: vi.fn(() => chainable(result)) };
  }

  it("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    const res = await recurringManualDelete(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns bad request for an invalid id", async () => {
    const res = await recurringManualDelete(jsonRequest({ id: "bad" }));
    expect(res.status).toBe(400);
  });

  it("deletes successfully", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: delSupabase(() => ({ error: null })),
    });
    const res = await recurringManualDelete(jsonRequest({ id: UUID }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: UUID });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_recurring_item_deleted" }),
    );
  });

  it("returns 500 when the delete throws (line 213 catch)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: delSupabase(() => Promise.reject(new Error("delete reject"))),
    });
    const res = await recurringManualDelete(jsonRequest({ id: UUID }));
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("recurring.manual.delete", expect.any(Error));
  });
});

describe("GET /api/household/accept", () => {
  const TOKEN = "abcdefghijklmnopqrst"; // >= 20 chars
  const futureExpiry = new Date(Date.now() + 100000).toISOString();

  it("redirects to login when not signed in (line 16-18)", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    const res = await householdAcceptGet(
      new NextRequest(`http://localhost/api/household/accept?token=${TOKEN}`),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects to invalid for a short token (line 23)", async () => {
    const res = await householdAcceptGet(
      new NextRequest("http://localhost/api/household/accept?token=short"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/settings?invite=invalid",
    );
  });

  it("redirects to invalid when the invite is missing (line 40)", async () => {
    serviceClient = { from: vi.fn((t: string) => chainable(() => (t === "household_members" ? { error: null } : { data: null, error: null }))) };
    const res = await householdAcceptGet(
      new NextRequest(`http://localhost/api/household/accept?token=${TOKEN}`),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/settings?invite=invalid",
    );
  });

  it("redirects to invalid on email mismatch (line 40)", async () => {
    serviceClient = {
      from: vi.fn((t: string) =>
        chainable(() => {
          if (t === "household_members") return { error: null };
          return {
            data: {
              id: "inv1",
              household_id: "h1",
              email: "other@example.com",
              expires_at: futureExpiry,
              accepted_at: null,
            },
            error: null,
          };
        }),
      ),
    };
    const res = await householdAcceptGet(
      new NextRequest(`http://localhost/api/household/accept?token=${TOKEN}`),
    );
    expect(res.headers.get("location")).toBe(
      "http://localhost/settings?invite=invalid",
    );
  });

  it("accepts a valid invite and redirects (line 51 no-error branch)", async () => {
    serviceClient = {
      from: vi.fn((t: string) =>
        chainable(() => {
          if (t === "household_members") return { error: null };
          return {
            data: {
              id: "inv1",
              household_id: "h1",
              email: USER.email,
              expires_at: futureExpiry,
              accepted_at: null,
            },
            error: null,
          };
        }),
      ),
    };
    const res = await householdAcceptGet(
      new NextRequest(`http://localhost/api/household/accept?token=${TOKEN}`),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/settings?invite=accepted",
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "household_invite_accepted" }),
    );
  });

  it("treats a duplicate membership error as success (line 51 duplicate branch)", async () => {
    serviceClient = {
      from: vi.fn((t: string) =>
        chainable(() => {
          if (t === "household_members")
            return { error: { message: "duplicate key value violates" } };
          return {
            data: {
              id: "inv1",
              household_id: "h1",
              email: USER.email,
              expires_at: futureExpiry,
              accepted_at: null,
            },
            error: null,
          };
        }),
      ),
    };
    const res = await householdAcceptGet(
      new NextRequest(`http://localhost/api/household/accept?token=${TOKEN}`),
    );
    expect(res.headers.get("location")).toBe(
      "http://localhost/settings?invite=accepted",
    );
  });

  it("returns 500 when membership insert throws a non-duplicate error (line 51/67)", async () => {
    serviceClient = {
      from: vi.fn((t: string) =>
        chainable(() => {
          if (t === "household_members") return { error: { message: "boom" } };
          return {
            data: {
              id: "inv1",
              household_id: "h1",
              email: USER.email,
              expires_at: futureExpiry,
              accepted_at: null,
            },
            error: null,
          };
        }),
      ),
    };
    const res = await householdAcceptGet(
      new NextRequest(`http://localhost/api/household/accept?token=${TOKEN}`),
    );
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith(
      "household.accept",
      expect.objectContaining({ message: "boom" }),
    );
  });
});

describe("POST /api/household/invite", () => {
  function inviteSupabase(inviteError: unknown, ownerId: string) {
    return {
      from: vi.fn((t: string) =>
        chainable(() => {
          if (t === "households")
            return { data: { id: "h1", name: "Home", owner_user_id: ownerId }, error: null };
          return { error: inviteError };
        }),
      ),
    };
  }

  it("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    const res = await householdInvitePost(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue(false);
    const res = await householdInvitePost(jsonRequest({}));
    expect(res.status).toBe(429);
  });

  it("returns bad request for invalid input", async () => {
    const res = await householdInvitePost(jsonRequest({ householdId: "h1" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the household is not owned", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: inviteSupabase(null, "someone-else"),
    });
    const res = await householdInvitePost(
      jsonRequest({ householdId: "h1", email: "p@example.com" }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 500 when the invite insert errors (line 57/76)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: inviteSupabase(new Error("insert fail"), USER.id),
    });
    const res = await householdInvitePost(
      jsonRequest({ householdId: "h1", email: "p@example.com" }),
    );
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("household.invite", expect.any(Error));
  });

  it("sends an invite with an app url set (line 59 appUrl side)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: inviteSupabase(null, USER.id),
    });
    const res = await householdInvitePost(
      jsonRequest({ householdId: "h1", email: "p@example.com" }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mockSendHouseholdInviteEmail).toHaveBeenCalledWith(
      "p@example.com",
      USER.email,
      "Home",
      expect.stringContaining("https://app.example.com/api/household/accept?token="),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "household_invite_sent" }),
    );
  });

  it("sends an invite with the fallback app url (line 59 fallback side)", async () => {
    appUrl = undefined;
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: inviteSupabase(null, USER.id),
    });
    const res = await householdInvitePost(
      jsonRequest({ householdId: "h1", email: "p@example.com" }),
    );
    expect(res.status).toBe(200);
    expect(mockSendHouseholdInviteEmail).toHaveBeenCalledWith(
      "p@example.com",
      USER.email,
      "Home",
      expect.stringContaining("http://localhost:3000/api/household/accept?token="),
    );
  });
});
