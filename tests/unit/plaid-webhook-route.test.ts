import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetItemByPlaidItemId = vi.fn();
const mockSetItemStatus = vi.fn();
vi.mock("@/lib/plaid-service", () => ({
  getItemByPlaidItemId: (...args: unknown[]) =>
    mockGetItemByPlaidItemId(...args),
  setItemStatus: (...args: unknown[]) => mockSetItemStatus(...args),
}));

const mockSyncItemTransactions = vi.fn();
vi.mock("@/lib/sync", () => ({
  syncItemTransactions: (...args: unknown[]) =>
    mockSyncItemTransactions(...args),
}));

const mockRefreshRecurringForItem = vi.fn();
vi.mock("@/lib/recurring", () => ({
  refreshRecurringForItem: (...args: unknown[]) => mockRefreshRecurringForItem(...args),
}));

const mockRefreshInferredRecurringForItem = vi.fn();
vi.mock("@/lib/recurring-inference", () => ({
  refreshInferredRecurringForItem: (...args: unknown[]) =>
    mockRefreshInferredRecurringForItem(...args),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockErrorResponse = vi.fn((context, err) => {
  console.error("MOCKED WEBHOOK ERROR:", context, err);
  return new Response("error", { status: 500 });
});
const mockBadRequest = vi.fn((msg) => new Response(msg, { status: 400 }));
vi.mock("@/lib/http", () => ({
  errorResponse: (context: string, err: unknown) => mockErrorResponse(context, err),
  badRequest: (msg: string) => mockBadRequest(msg),
}));

import { POST } from "@/app/api/plaid/webhook/route";
import { NextRequest } from "next/server";

describe("POST /api/plaid/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncItemTransactions.mockResolvedValue({ added: 0, modified: 0, removed: 0 });
    mockRefreshRecurringForItem.mockResolvedValue(0);
    mockRefreshInferredRecurringForItem.mockResolvedValue({
      active: 0,
      added: 0,
      deactivated: 0,
      deduplicated: 0,
      failed: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 if webhook verification fails in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAID_ENV", "production");
    const request = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(request);
    expect(res.status).toBe(401);
  });

  it("processes TRANSACTIONS SYNC_UPDATES_AVAILABLE webhook in development", async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    const request = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "item-123",
      }),
    });

    const mockItem = { id: "db-item-123", user_id: "user-1" };
    mockGetItemByPlaidItemId.mockResolvedValue(mockItem);

    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(mockGetItemByPlaidItemId).toHaveBeenCalledWith("item-123");
    expect(mockSyncItemTransactions).toHaveBeenCalledWith(mockItem);
    expect(mockRefreshInferredRecurringForItem).toHaveBeenCalledWith(mockItem);
    expect(mockSyncItemTransactions.mock.invocationCallOrder[0]).toBeLessThan(
      mockRefreshInferredRecurringForItem.mock.invocationCallOrder[0],
    );
    expect(mockRefreshRecurringForItem).not.toHaveBeenCalled();
  });

  it("acknowledges a transaction webhook when derived inference fails", async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    const request = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "item-123",
      }),
    });

    const mockItem = { id: "db-item-123", user_id: "user-1" };
    const inferenceError = new Error("inference unavailable");
    mockGetItemByPlaidItemId.mockResolvedValue(mockItem);
    mockSyncItemTransactions.mockResolvedValue({ added: 1, modified: 0, removed: 0 });
    mockRefreshInferredRecurringForItem.mockRejectedValue(inferenceError);

    const res = await POST(request);

    expect(res.status).toBe(200);
    expect(mockSyncItemTransactions).toHaveBeenCalledWith(mockItem);
    expect(mockLogError).toHaveBeenCalledWith("webhook.transactions.inference", inferenceError);
  });

  it("refreshes provider streams then inference on RECURRING_TRANSACTIONS_UPDATE", async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    const request = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "RECURRING_TRANSACTIONS_UPDATE",
        item_id: "item-123",
      }),
    });

    const mockItem = { id: "db-item-123", user_id: "user-1" };
    mockGetItemByPlaidItemId.mockResolvedValue(mockItem);

    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(mockRefreshRecurringForItem).toHaveBeenCalledWith(mockItem);
    expect(mockRefreshInferredRecurringForItem).toHaveBeenCalledWith(mockItem);
    expect(mockRefreshRecurringForItem.mock.invocationCallOrder[0]).toBeLessThan(
      mockRefreshInferredRecurringForItem.mock.invocationCallOrder[0],
    );
    expect(mockSyncItemTransactions).not.toHaveBeenCalled();
  });

  it("rejects RECURRING_TRANSACTIONS_UPDATE without an item_id", async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    const request = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "RECURRING_TRANSACTIONS_UPDATE",
      }),
    });

    const res = await POST(request);
    expect(res.status).toBe(400);
    expect(mockRefreshRecurringForItem).not.toHaveBeenCalled();
    expect(mockRefreshInferredRecurringForItem).not.toHaveBeenCalled();
  });

  it("still runs local inference and acknowledges when recurring refreshes fail", async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    const request = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "RECURRING_TRANSACTIONS_UPDATE",
        item_id: "item-123",
      }),
    });

    const mockItem = { id: "db-item-123", user_id: "user-1" };
    const providerError = new Error("plaid down");
    const inferenceError = new Error("inference unavailable");
    mockGetItemByPlaidItemId.mockResolvedValue(mockItem);
    mockRefreshRecurringForItem.mockRejectedValue(providerError);
    mockRefreshInferredRecurringForItem.mockRejectedValue(inferenceError);

    const res = await POST(request);

    expect(res.status).toBe(200);
    expect(mockRefreshInferredRecurringForItem).toHaveBeenCalledWith(mockItem);
    expect(mockLogError).toHaveBeenCalledWith("webhook.recurring.provider", providerError);
    expect(mockLogError).toHaveBeenCalledWith("webhook.recurring.inference", inferenceError);
  });

  it("processes ITEM ERROR webhook", async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    const request = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "ITEM",
        webhook_code: "ERROR",
        item_id: "item-123",
        error: { error_code: "ITEM_LOGIN_REQUIRED" },
      }),
    });

    const mockItem = { id: "db-item-123", user_id: "user-1" };
    mockGetItemByPlaidItemId.mockResolvedValue(mockItem);

    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(mockSetItemStatus).toHaveBeenCalledWith(
      "user-1",
      "db-item-123",
      "error",
      "ITEM_LOGIN_REQUIRED",
    );
  });

  it("processes ITEM USER_PERMISSION_REVOKED webhook", async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    const request = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "ITEM",
        webhook_code: "USER_PERMISSION_REVOKED",
        item_id: "item-123",
      }),
    });

    const mockItem = { id: "db-item-123", user_id: "user-1" };
    mockGetItemByPlaidItemId.mockResolvedValue(mockItem);

    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(mockSetItemStatus).toHaveBeenCalledWith(
      "user-1",
      "db-item-123",
      "disconnected",
      "USER_PERMISSION_REVOKED",
    );
  });
});
