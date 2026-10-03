import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockRequireUser = vi.fn();
const mockRpc = vi.fn();
let reportsOnlyEnabled = false;

vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: () => NextResponse.json({ error: "error" }, { status: 500 }),
}));
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => reportsOnlyEnabled,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  getClientIp: () => "127.0.0.1",
}));

import { GET } from "@/app/api/household/aggregates/route";

beforeEach(() => {
  vi.clearAllMocks();
  reportsOnlyEnabled = false;
  mockRpc.mockResolvedValue({ data: [], error: null });
  mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: { rpc: mockRpc } });
});

describe("GET /api/household/aggregates", () => {
  it("keeps the new aggregate surface unavailable while the flag is off", async () => {
    const response = await GET(new NextRequest("http://localhost/api/household/aggregates"));
    expect(response.status).toBe(404);
    expect(mockRequireUser).not.toHaveBeenCalled();
  });

  it("validates the bounded filter contract", async () => {
    reportsOnlyEnabled = true;
    const response = await GET(new NextRequest("http://localhost/api/household/aggregates?householdId=h1&start=2026-02-30&end=2026-03-01"));
    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls only the aggregate RPC and returns its allowlisted rows", async () => {
    reportsOnlyEnabled = true;
    mockRpc.mockResolvedValue({
      data: [{ month: "2026-01-01", category: "FOOD_AND_DRINK", total_amount: 90, outflow_total: 120, inflow_total: 30, transaction_count: 4 }],
      error: null,
    });
    const response = await GET(new NextRequest("http://localhost/api/household/aggregates?householdId=h1&start=2026-01-01&end=2026-03-31&category=food_and_drink"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      aggregates: [{ month: "2026-01-01", category: "FOOD_AND_DRINK", total_amount: 90, outflow_total: 120, inflow_total: 30, transaction_count: 4 }],
    });
    expect(mockRpc).toHaveBeenCalledWith("household_report_aggregates", {
      p_household_id: "h1",
      p_start: "2026-01-01",
      p_end: "2026-03-31",
      p_category: "food_and_drink",
    });
  });
});
