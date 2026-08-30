import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockBadRequest = vi.fn((msg: string) => new Response(msg, { status: 400 }));
const mockErrorResponse = vi.fn(
  (context: string, err: unknown) => new Response(`error: ${context}: ${String((err as Error)?.message ?? err)}`, { status: 500 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  badRequest: (msg: string) => mockBadRequest(msg),
  errorResponse: (context: string, err: unknown) => mockErrorResponse(context, err),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(() => true);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

const mockLogError = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockItemGet = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({ itemGet: (...args: unknown[]) => mockItemGet(...args) }),
}));

const mockDecryptItemTokenAndUpgrade = vi.fn<(...args: unknown[]) => unknown>(() => "token");
const mockSetItemStatus = vi.fn<(...args: unknown[]) => unknown>();
const mockGetItem = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid-service", () => ({
  decryptItemTokenAndUpgrade: (...args: unknown[]) => mockDecryptItemTokenAndUpgrade(...args),
  setItemStatus: (...args: unknown[]) => mockSetItemStatus(...args),
  getItem: (...args: unknown[]) => mockGetItem(...args),
}));

const mockBackfillItemTransactions = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/sync", () => ({
  backfillItemTransactions: (...args: unknown[]) => mockBackfillItemTransactions(...args),
  ItemSyncInProgressError: class ItemSyncInProgressError extends Error {},
}));

import { POST } from "@/app/api/plaid/repair/route";
import { NextResponse, type NextRequest } from "next/server";

const item = {
  id: "item-1",
  user_id: "user-1",
  plaid_item_id: "plaid-item-1",
  institution_id: "inst-1",
  institution_name: "Chase Bank",
  access_token_ciphertext: "cipher",
  access_token_iv: "iv",
  access_token_tag: "tag",
  sync_cursor: null,
  status: "error",
  error_code: "ITEM_LOGIN_REQUIRED",
};

function jsonRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

describe("POST /api/plaid/repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    mockCheckRateLimit.mockResolvedValue(true);
    mockSetItemStatus.mockResolvedValue(undefined);
    mockItemGet.mockResolvedValue({ data: { item: { item_id: "plaid-item-1" } } });
    mockBackfillItemTransactions.mockResolvedValue({
      pagesCompleted: 3,
      maxPages: 8,
      completed: true,
      added: 4,
      modified: 1,
      removed: 0,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    const unauthorized = new NextResponse("Unauthorized", { status: 401 });
    mockRequireUser.mockResolvedValue(unauthorized);
    const res = await POST(jsonRequest({ itemId: "item-1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a missing itemId", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalled();
  });

  it("returns 400 for a non-string itemId", async () => {
    const res = await POST(jsonRequest({ itemId: 42 }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Missing itemId");
  });

  it("returns 404 when the item does not belong to the caller", async () => {
    mockGetItem.mockResolvedValue(null);
    const res = await POST(jsonRequest({ itemId: "item-1" }));
    expect(res.status).toBe(404);
    // Ownership is enforced by scoping the lookup to the caller's user id.
    expect(mockGetItem).toHaveBeenCalledWith("user-1", "item-1");
  });

  it("rate-limits repair attempts per user", async () => {
    mockGetItem.mockResolvedValue(item);
    mockCheckRateLimit.mockResolvedValue(false);
    const res = await POST(jsonRequest({ itemId: "item-1" }));
    expect(res.status).toBe(429);
    expect(mockCheckRateLimit).toHaveBeenCalledWith("repair:user-1", 3, 60);
  });

  it("reports product_not_ready distinctly", async () => {
    mockGetItem.mockResolvedValue(item);
    mockItemGet.mockRejectedValue({
      response: { data: { error_code: "PRODUCT_NOT_READY" } },
    });
    const res = await POST(jsonRequest({ itemId: "item-1" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      status: "product_not_ready",
    });
  });

  it("reports consent_required distinctly", async () => {
    mockGetItem.mockResolvedValue(item);
    mockItemGet.mockRejectedValue({
      response: { data: { error_code: "ADDITIONAL_CONSENT_REQUIRED" } },
    });
    const res = await POST(jsonRequest({ itemId: "item-1" }));
    const body = await res.json();
    expect(body.status).toBe("consent_required");
  });

  it("reports institution_login_required distinctly", async () => {
    mockGetItem.mockResolvedValue(item);
    mockItemGet.mockRejectedValue({
      response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } },
    });
    const res = await POST(jsonRequest({ itemId: "item-1" }));
    const body = await res.json();
    expect(body.status).toBe("institution_login_required");
  });

  it("never persists an unsafe provider payload as the item error code", async () => {
    mockGetItem.mockResolvedValue(item);
    mockItemGet.mockRejectedValue({
      response: { data: { error_code: "token=secret customer@example.com" } },
    });
    const res = await POST(jsonRequest({ itemId: "item-1" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      status: "institution_login_required",
    });
    expect(mockSetItemStatus).not.toHaveBeenCalled();
  });

  it("returns 500 without marking the item broken for a transient readiness failure", async () => {
    mockGetItem.mockResolvedValue(item);
    mockItemGet.mockRejectedValue(new Error("network timeout"));

    const res = await POST(jsonRequest({ itemId: "item-1" }));

    expect(res.status).toBe(500);
    expect(mockSetItemStatus).not.toHaveBeenCalled();
  });

  it("reports rate_limited with a 429", async () => {
    mockGetItem.mockResolvedValue(item);
    mockBackfillItemTransactions.mockRejectedValue({
      response: { data: { error_code: "RATE_LIMIT_EXCEEDED" } },
    });
    const res = await POST(jsonRequest({ itemId: "item-1" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.status).toBe("rate_limited");
  });

  it("reports a bounded backfill with progress and its final result", async () => {
    mockGetItem.mockResolvedValue(item);
    mockBackfillItemTransactions.mockResolvedValue({
      pagesCompleted: 5,
      maxPages: 8,
      completed: false,
      added: 40,
      modified: 2,
      removed: 0,
    });
    const res = await POST(jsonRequest({ itemId: "item-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      status: "backfill_incomplete",
      pagesCompleted: 5,
      maxPages: 8,
      completed: false,
      added: 40,
    });
  });

  it("runs the bounded backfill only after provider readiness and audits the attempt", async () => {
    mockGetItem.mockResolvedValue(item);
    const res = await POST(jsonRequest({ itemId: "item-1" }));
    expect(res.status).toBe(200);
    expect(mockItemGet).toHaveBeenCalledTimes(1);
    expect(mockBackfillItemTransactions).toHaveBeenCalledWith(item, { maxPages: 8 });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "plaid_repair",
        metadata: expect.objectContaining({
          itemId: "item-1",
          pagesCompleted: 3,
          completed: true,
        }),
      }),
    );
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "repaired" });
  });
});
