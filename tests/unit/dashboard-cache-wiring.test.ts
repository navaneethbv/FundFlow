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

  it("caches different drill scopes separately", async () => {
    const base = await getCachedDashboardData(supabase, "drill-user", undefined, "2026-07");
    const drilled = await getCachedDashboardData(supabase, "drill-user", undefined, "2026-07", {
      drill: { category: "FOOD_AND_DRINK" },
    });
    const drilledAgain = await getCachedDashboardData(supabase, "drill-user", undefined, "2026-07", {
      drill: { category: "FOOD_AND_DRINK" },
    });
    expect(mockGetDashboardData).toHaveBeenCalledTimes(2);
    expect(drilled).not.toBe(base);
    expect(drilledAgain).toBe(drilled);
  });

  it("caches item-filtered scopes separately", async () => {
    await getCachedDashboardData(supabase, "item-user", undefined, "2026-07");
    await getCachedDashboardData(supabase, "item-user", undefined, "2026-07", { itemId: "item-1" });
    expect(mockGetDashboardData).toHaveBeenCalledTimes(2);
  });
});

import { dashboardScopeKey } from "@/lib/dashboard-cache";

describe("dashboardScopeKey", () => {
  it("encodes every drill dimension", () => {
    // The trailing dimension is the household scope (4.2) — "mine" default.
    expect(dashboardScopeKey(undefined, undefined)).toBe("all:default:all:-:-:-:mine");
    expect(
      dashboardScopeKey("acct-1", "2026-07", {
        itemId: "item-1",
        drill: { category: "FOOD_AND_DRINK", sub: "FOOD_AND_DRINK_COFFEE" },
      }),
    ).toBe("acct-1:2026-07:item-1:FOOD_AND_DRINK:FOOD_AND_DRINK_COFFEE:-:mine");
    expect(dashboardScopeKey(undefined, "2026-07", { drill: { merchant: "Netflix" } })).toBe(
      "all:2026-07:all:-:-:Netflix:mine",
    );
    expect(
      dashboardScopeKey(undefined, undefined, { scope: "household" }),
    ).toBe("all:default:all:-:-:-:household");
  });
});
