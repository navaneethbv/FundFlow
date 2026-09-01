import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_ctx: unknown, error: unknown) =>
    NextResponse.json({ error: (error as Error).message }, { status: 500 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
}));

const mockSyncAllForUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/sync", () => ({
  syncAllForUser: (...args: unknown[]) => mockSyncAllForUser(...args),
}));

const mockRefreshRecurringForUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/recurring", () => ({
  refreshRecurringForUser: (...args: unknown[]) => mockRefreshRecurringForUser(...args),
}));

const mockRefreshInferredRecurringForUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/recurring-inference", () => ({
  refreshInferredRecurringForUser: (...args: unknown[]) =>
    mockRefreshInferredRecurringForUser(...args),
}));

const mockTryWriteDailyAccountSnapshots = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/account-history", () => ({
  tryWriteDailyAccountSnapshots: (...args: unknown[]) =>
    mockTryWriteDailyAccountSnapshots(...args),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

import { POST } from "@/app/api/plaid/sync/route";

function post(body: unknown, opts: { rejectJson?: boolean } = {}) {
  return {
    url: "https://x.local/api/plaid/sync",
    json: opts.rejectJson
      ? () => Promise.reject(new Error("bad json"))
      : () => Promise.resolve(body),
  } as unknown as NextRequest;
}

describe("POST /api/plaid/sync (r3-n2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    mockCheckRateLimit.mockResolvedValue(true);
    mockSyncAllForUser.mockResolvedValue({ added: 2, modified: 1, removed: 0 });
    mockRefreshRecurringForUser.mockResolvedValue(3);
  });

  it("returns the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await POST({} as NextRequest);
    expect(res.status).toBe(401);
  });

  it("treats a rejected JSON body as a manual refresh", async () => {
    const res = await POST(post({}, { rejectJson: true }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      added: 2,
      modified: 1,
      removed: 0,
      recurring_streams: 3,
    });
    expect(mockRefreshRecurringForUser).toHaveBeenCalledWith("user-1");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "data_refresh", userId: "user-1" }),
    );
  });

  it("skips an auto-sync whose window is closed", async () => {
    mockCheckRateLimit.mockResolvedValueOnce(false);
    const res = await POST(post({ source: "auto" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, skipped: true });
    expect(mockSyncAllForUser).not.toHaveBeenCalled();
  });

  it("returns 429 for an auto-sync when the manual limiter is exhausted", async () => {
    mockCheckRateLimit
      .mockResolvedValueOnce(true) // autosync window open
      .mockResolvedValueOnce(false); // sync limiter closed
    const res = await POST(post({ source: "auto" }));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({
      error: "Too many refreshes. Please wait a moment.",
    });
    expect(mockSyncAllForUser).not.toHaveBeenCalled();
  });

  it("runs a full auto-sync without recurring or audit", async () => {
    mockRefreshInferredRecurringForUser.mockResolvedValue({ active: 0, added: 0, deactivated: 0, deduplicated: 0, failed: 0 });
    const res = await POST(post({ source: "auto" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      added: 2,
      modified: 1,
      removed: 0,
      recurring_streams: { plaid: 0, inferred: { active: 0, added: 0, deactivated: 0, deduplicated: 0, failed: 0 } },
    });
    expect(mockSyncAllForUser).toHaveBeenCalledWith("user-1");
    expect(mockTryWriteDailyAccountSnapshots).toHaveBeenCalledWith(
      "user-1",
      "plaid.sync.snapshot",
    );
    expect(mockRefreshRecurringForUser).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("returns 429 when the manual sync limiter is closed", async () => {
    mockCheckRateLimit.mockResolvedValueOnce(false);
    const res = await POST(post({}));
    expect(res.status).toBe(429);
    expect(mockSyncAllForUser).not.toHaveBeenCalled();
  });

  it("runs a manual sync, refreshes recurring streams, and audits", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      added: 2,
      modified: 1,
      removed: 0,
      recurring_streams: 3,
    });
    expect(mockCheckRateLimit).toHaveBeenCalledWith("sync:user-1", 6, 60);
    expect(mockRefreshRecurringForUser).toHaveBeenCalledWith("user-1");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "data_refresh",
        metadata: { added: 2, modified: 1, removed: 0, recurring_streams: 3 },
      }),
    );
  });

  it("returns an error response when the sync throws", async () => {
    mockSyncAllForUser.mockRejectedValue(new Error("Sync error"));
    const res = await POST(post({}));
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("plaid.sync", expect.any(Error));
    expect(mockTryWriteDailyAccountSnapshots).not.toHaveBeenCalled();
  });

  it("returns an error response when the snapshots write throws", async () => {
    mockTryWriteDailyAccountSnapshots.mockRejectedValue(new Error("snapshot boom"));
    const res = await POST(post({}));
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("plaid.sync", expect.any(Error));
  });
});