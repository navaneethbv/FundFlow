import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/plaid/repair/route";

vi.mock("@/lib/http", () => ({
  requireUser: vi.fn().mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } }),
  errorResponse: vi.fn((tag, err) => new Response(JSON.stringify({ error: String(err) }), { status: 500 })),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
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
  syncItemTransactions: vi.fn().mockResolvedValue({ added: 10, modified: 0, removed: 0 }),
}));

vi.mock("@/lib/plaid", () => ({
  getPlaidClient: vi.fn().mockReturnValue({
    itemGet: vi.fn().mockResolvedValue({
      data: {
        item: {
          available_products: ["transactions", "investments"],
          billed_products: ["transactions"],
          consent_expiration_time: null,
        },
      },
    }),
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn().mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "item-1",
          user_id: "user-1",
          institution_name: "Chase",
          status: "active",
          sync_cursor: "cursor-1",
        },
        error: null,
      }),
    })),
  }),
}));

describe("POST /api/plaid/repair", () => {
  it("rejects request without itemId", async () => {
    const req = new NextRequest("http://localhost/api/plaid/repair", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("diagnoses item status successfully", async () => {
    const req = new NextRequest("http://localhost/api/plaid/repair", {
      method: "POST",
      body: JSON.stringify({ itemId: "item-1", action: "diagnose" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.availableProducts).toContain("transactions");
  });

  it("runs resync and backfill action successfully", async () => {
    const req = new NextRequest("http://localhost/api/plaid/repair", {
      method: "POST",
      body: JSON.stringify({ itemId: "item-1", action: "reset_cursor" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.syncResult.added).toBe(10);
  });
});
