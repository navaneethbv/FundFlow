import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn();
const mockErrorResponse = vi.fn();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
}));

const mockSyncAllForUser = vi.fn();
vi.mock("@/lib/sync", () => ({
  syncAllForUser: (...args: unknown[]) => mockSyncAllForUser(...args),
}));

const mockRefreshRecurringForUser = vi.fn();
vi.mock("@/lib/recurring", () => ({
  refreshRecurringForUser: (...args: unknown[]) => mockRefreshRecurringForUser(...args),
}));

const mockRefreshInferredForUser = vi.fn().mockResolvedValue({
  active: 0, added: 0, deactivated: 0, deduplicated: 0,
});
vi.mock("@/lib/recurring-inference", () => ({
  refreshInferredRecurringForUser: (...args: unknown[]) => mockRefreshInferredForUser(...args),
}));

const mockWriteDailyAccountSnapshots = vi.fn();
vi.mock("@/lib/account-history", () => ({
  writeDailyAccountSnapshots: (...args: unknown[]) =>
    mockWriteDailyAccountSnapshots(...args),
  tryWriteDailyAccountSnapshots: (...args: unknown[]) =>
    mockWriteDailyAccountSnapshots(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockWriteAudit = vi.fn();
const mockGetClientIp = vi.fn().mockReturnValue("127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

import { POST } from "@/app/api/plaid/sync/route";
import { NextRequest, NextResponse } from "next/server";

describe("POST /api/plaid/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early if user is unauthenticated", async () => {
    const errorResponseObject = new NextResponse("unauthorized", { status: 401 });
    mockRequireUser.mockResolvedValue(errorResponseObject);

    const req = new NextRequest("http://localhost/api/plaid/sync", { method: "POST" });
    const res = await POST(req);
    expect(res).toBe(errorResponseObject);
  });

  it("returns 429 when rate limit is exceeded for manual sync", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    mockCheckRateLimit.mockResolvedValue(false);

    const req = new NextRequest("http://localhost/api/plaid/sync", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("Too many refreshes");
  });

  it("skips auto sync when autosync window rate limit is not open", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    mockCheckRateLimit.mockResolvedValueOnce(false); // autosync rate limit fails

    const req = new NextRequest("http://localhost/api/plaid/sync", {
      method: "POST",
      body: JSON.stringify({ source: "auto" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: true });
    expect(mockSyncAllForUser).not.toHaveBeenCalled();
  });

  it("performs manual sync with the full hybrid recurring refresh and writes audit log", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    mockCheckRateLimit.mockResolvedValue(true);
    mockSyncAllForUser.mockResolvedValue({ added: 2, modified: 1, removed: 0 });
    mockRefreshRecurringForUser.mockResolvedValue({
      plaid: 2,
      inferred: { active: 1, added: 1, deactivated: 0, deduplicated: 0 },
    });

    const req = new NextRequest("http://localhost/api/plaid/sync", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      added: 2,
      modified: 1,
      removed: 0,
      recurring_streams: {
        plaid: 2,
        inferred: { active: 1, added: 1, deactivated: 0, deduplicated: 0 },
      },
    });
    expect(mockRefreshRecurringForUser).toHaveBeenCalledWith("user-1");
    expect(mockRefreshInferredForUser).not.toHaveBeenCalled();
    expect(mockWriteDailyAccountSnapshots).toHaveBeenCalledWith(
      "user-1",
      "plaid.sync.snapshot",
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "data_refresh",
      }),
    );
  });

  it("auto sync skips the Plaid recurring endpoint but still runs local inference", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    mockCheckRateLimit.mockResolvedValue(true);
    mockSyncAllForUser.mockResolvedValue({ added: 0, modified: 0, removed: 0 });
    mockRefreshInferredForUser.mockResolvedValueOnce({
      active: 1,
      added: 1,
      deactivated: 0,
      deduplicated: 0,
    });

    const req = new NextRequest("http://localhost/api/plaid/sync", {
      method: "POST",
      body: JSON.stringify({ source: "auto" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      added: 0,
      modified: 0,
      removed: 0,
      recurring_streams: {
        plaid: 0,
        inferred: { active: 1, added: 1, deactivated: 0, deduplicated: 0 },
      },
    });
    expect(mockRefreshRecurringForUser).not.toHaveBeenCalled();
    expect(mockRefreshInferredForUser).toHaveBeenCalledWith("user-1");
  });

  it("calls errorResponse when sync throws error", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    mockCheckRateLimit.mockResolvedValue(true);
    mockSyncAllForUser.mockRejectedValue(new Error("Sync error"));
    mockErrorResponse.mockReturnValue(new Response("error", { status: 500 }));

    const req = new NextRequest("http://localhost/api/plaid/sync", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(mockWriteDailyAccountSnapshots).not.toHaveBeenCalled();
    expect(mockErrorResponse).toHaveBeenCalledWith("plaid.sync", expect.any(Error));
  });
});
