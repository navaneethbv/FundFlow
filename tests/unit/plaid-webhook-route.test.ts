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

const mockErrorResponse = vi.fn((context, err) => {
  console.error("MOCKED WEBHOOK ERROR:", context, err);
  return new Response("error", { status: 500 });
});
const mockBadRequest = vi.fn((msg) => new Response(msg, { status: 400 }));
vi.mock("@/lib/http", () => ({
  errorResponse: (context: string, err: any) => mockErrorResponse(context, err),
  badRequest: (msg: string) => mockBadRequest(msg),
}));

import { POST } from "@/app/api/plaid/webhook/route";
import { NextRequest } from "next/server";

describe("POST /api/plaid/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const mockItem = { id: "db-item-123" };
    mockGetItemByPlaidItemId.mockResolvedValue(mockItem);

    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(mockGetItemByPlaidItemId).toHaveBeenCalledWith("item-123");
    expect(mockSyncItemTransactions).toHaveBeenCalledWith(mockItem);
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

    const mockItem = { id: "db-item-123" };
    mockGetItemByPlaidItemId.mockResolvedValue(mockItem);

    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(mockSetItemStatus).toHaveBeenCalledWith(
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

    const mockItem = { id: "db-item-123" };
    mockGetItemByPlaidItemId.mockResolvedValue(mockItem);

    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(mockSetItemStatus).toHaveBeenCalledWith(
      "db-item-123",
      "disconnected",
      "USER_PERMISSION_REVOKED",
    );
  });
});
