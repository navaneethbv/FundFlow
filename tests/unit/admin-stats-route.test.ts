import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const mockRequireAdmin = vi.fn();
const mockErrorResponse = vi.fn();
vi.mock("@/lib/http", () => ({
  requireAdmin: () => mockRequireAdmin(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
}));

const mockServiceClient = {
  from: vi.fn(),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

import { GET } from "@/app/api/admin/stats/route";

describe("GET /api/admin/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early when requireAdmin returns NextResponse", async () => {
    const unauth = new NextResponse("forbidden", { status: 403 });
    mockRequireAdmin.mockResolvedValue(unauth);

    const res = await GET();
    expect(res).toBe(unauth);
  });

  it("returns stats with counts and falls back to 0 when count is null", async () => {
    mockRequireAdmin.mockResolvedValue({ user: { id: "admin-1" } });
    mockServiceClient.from.mockImplementation((table) => {
      if (table === "plaid_items") return { select: () => Promise.resolve({ count: 12, error: null }) };
      if (table === "accounts") return { select: () => Promise.resolve({ count: null, error: null }) };
      if (table === "transactions") return { select: () => Promise.resolve({ count: 450, error: null }) };
      return { select: () => Promise.resolve({ count: 0, error: null }) };
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ plaid_items: 12, accounts: 0, transactions: 450 });
  });

  it("calls errorResponse on DB failure", async () => {
    mockRequireAdmin.mockResolvedValue({ user: { id: "admin-1" } });
    mockServiceClient.from.mockImplementation(() => {
      throw new Error("Stats error");
    });
    mockErrorResponse.mockReturnValue(new Response("error", { status: 500 }));

    const res = await GET();
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("admin.stats", expect.any(Error));
  });
});
