import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { NextResponse } from "next/server";

describe("GET /api/admin/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the auth response early if user is not an admin", async () => {
    const errorResponseObject = new NextResponse("unauthorized", { status: 403 });
    mockRequireAdmin.mockResolvedValue(errorResponseObject);

    const res = await GET();
    expect(res).toBe(errorResponseObject);
    expect(mockServiceClient.from).not.toHaveBeenCalled();
  });

  it("returns aggregated counts of plaid_items, accounts, and transactions on success", async () => {
    mockRequireAdmin.mockResolvedValue({ user: { id: "admin-1" } });

    const plaidChain = {
      select: vi.fn().mockResolvedValue({ count: 5 }),
    };
    const accountsChain = {
      select: vi.fn().mockResolvedValue({ count: 12 }),
    };
    const txnsChain = {
      select: vi.fn().mockResolvedValue({ count: 350 }),
    };

    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "plaid_items") return plaidChain;
      if (table === "accounts") return accountsChain;
      if (table === "transactions") return txnsChain;
      throw new Error(`Unexpected table ${table}`);
    });

    const res = await GET();
    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      plaid_items: 5,
      accounts: 12,
      transactions: 350,
    });
  });

  it("handles db query failures by calling errorResponse", async () => {
    mockRequireAdmin.mockResolvedValue({ user: { id: "admin-1" } });
    mockServiceClient.from.mockImplementation(() => {
      throw new Error("DB Connection Failed");
    });
    mockErrorResponse.mockReturnValue(new Response("error", { status: 500 }));

    const res = await GET();
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith(
      "admin.stats",
      expect.any(Error),
    );
  });
});
