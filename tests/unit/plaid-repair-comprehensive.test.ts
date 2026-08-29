import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/plaid/repair/route";

const mockRequireUser = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockItemGet = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (tag: string, err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/plaid-service", () => ({
  decryptItemToken: vi.fn().mockReturnValue("access-token-123"),
  setItemStatus: vi.fn().mockResolvedValue(undefined),
  updateItemCursor: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/sync", () => ({
  syncItemTransactions: vi.fn().mockResolvedValue({ added: 5, modified: 1, removed: 0 }),
}));

vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    itemGet: (...args: unknown[]) => mockItemGet(...args),
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: () => mockMaybeSingle(),
    }),
  }),
}));

describe("POST /api/plaid/repair Comprehensive Tests", () => {
  it("returns 429 when rate limit exceeded", async () => {
    mockRequireUser.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockCheckRateLimit.mockResolvedValueOnce(false);

    const req = new NextRequest("http://localhost/api/plaid/repair", {
      method: "POST",
      body: JSON.stringify({ itemId: "item-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
  });

  it("returns 400 for malformed json body", async () => {
    mockRequireUser.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockCheckRateLimit.mockResolvedValueOnce(true);

    const req = new NextRequest("http://localhost/api/plaid/repair", {
      method: "POST",
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when item is not found or owned by user", async () => {
    mockRequireUser.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockCheckRateLimit.mockResolvedValueOnce(true);
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const req = new NextRequest("http://localhost/api/plaid/repair", {
      method: "POST",
      body: JSON.stringify({ itemId: "item-missing" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("handles itemGet failure by setting error status and returning repair_required", async () => {
    mockRequireUser.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockCheckRateLimit.mockResolvedValueOnce(true);
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "item-1", user_id: "user-1", status: "active" },
      error: null,
    });
    mockItemGet.mockRejectedValueOnce({
      response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } },
    });

    const req = new NextRequest("http://localhost/api/plaid/repair", {
      method: "POST",
      body: JSON.stringify({ itemId: "item-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.status).toBe("repair_required");
    expect(body.errorCode).toBe("ITEM_LOGIN_REQUIRED");
  });
});
