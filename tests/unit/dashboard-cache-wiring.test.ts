import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDashboardData } = vi.hoisted(() => ({ mockGetDashboardData: vi.fn() }));

vi.mock("@/lib/dashboard", () => ({
  getDashboardData: mockGetDashboardData,
}));

import { getCachedDashboardData, invalidateDashboardCache } from "@/lib/dashboard-cache";

const supabase = {} as never;

describe("getCachedDashboardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDashboardData.mockImplementation(async () => ({ token: Math.random() }));
  });

  it("computes on a miss and serves the cache on a repeat call", async () => {
    const first = await getCachedDashboardData(supabase, "cache-user-a", undefined, "2026-07");
    const second = await getCachedDashboardData(supabase, "cache-user-a", undefined, "2026-07");
    expect(mockGetDashboardData).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("never serves one user's cache to another", async () => {
    const a = await getCachedDashboardData(supabase, "iso-user-a", undefined, "2026-07");
    const b = await getCachedDashboardData(supabase, "iso-user-b", undefined, "2026-07");
    expect(mockGetDashboardData).toHaveBeenCalledTimes(2);
    expect(b).not.toBe(a);
  });

  it("recomputes after invalidation", async () => {
    const first = await getCachedDashboardData(supabase, "inv-user", undefined, "2026-07");
    invalidateDashboardCache("inv-user");
    const second = await getCachedDashboardData(supabase, "inv-user", undefined, "2026-07");
    expect(mockGetDashboardData).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });
});
