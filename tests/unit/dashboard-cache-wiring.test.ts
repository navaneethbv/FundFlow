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
    // The trailing dimensions are the household scope (4.2), balance sheet
    // inclusion ("bs" default), and the viewer day (M-11).
    expect(dashboardScopeKey(undefined, undefined)).toBe(JSON.stringify([null, null, null, null, null, null, "mine", "bs", "server-day"]));
    expect(
      dashboardScopeKey("acct-1", "2026-07", {
        itemId: "item-1",
        drill: { category: "FOOD_AND_DRINK", sub: "FOOD_AND_DRINK_COFFEE" },
      }),
    ).toBe(JSON.stringify(["acct-1", "2026-07", "item-1", "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE", null, "mine", "bs", "server-day"]));
    expect(dashboardScopeKey(undefined, "2026-07", { drill: { merchant: "Netflix" } })).toBe(
      JSON.stringify([null, "2026-07", null, null, null, "Netflix", "mine", "bs", "server-day"]),
    );
    expect(
      dashboardScopeKey(undefined, undefined, { scope: "household" }),
    ).toBe(JSON.stringify([null, null, null, null, null, null, "household", "bs", "server-day"]));
    expect(
      dashboardScopeKey(undefined, undefined, { includeBalanceSheet: false }),
    ).toBe(JSON.stringify([null, null, null, null, null, null, "mine", "no-bs", "server-day"]));
    expect(dashboardScopeKey(undefined, undefined, { today: "2026-09-30" })).toBe(
      JSON.stringify([null, null, null, null, null, null, "mine", "bs", "2026-09-30"]),
    );
  });
});

import { createDashboardCache } from "@/lib/dashboard-cache";

describe("createDashboardCache expiration", () => {
  it("deletes expired records when accessed after TTL", async () => {
    const cache = createDashboardCache<string>(1);
    await cache.set("user-exp", "scope-1", "val-1");
    await new Promise((res) => setTimeout(res, 5));
    const val = await cache.get("user-exp", "scope-1");
    expect(val).toBeNull();
  });
});


describe("dashboard cache retention and scope identity", () => {
  it("bounds retained scopes and keeps recently read entries", async () => {
    const cache = createDashboardCache<string>(60_000);
    for (let i = 0; i < 32; i++) await cache.set("owner", String(i), String(i));
    await cache.get("owner", "0");
    await cache.set("owner", "32", "32");
    expect(await cache.get("owner", "1")).toBeNull();
    expect(await cache.get("owner", "0")).toBe("0");
    expect(await cache.get("owner", "32")).toBe("32");
  });

  it("keeps literal separators distinct across drill dimensions", () => {
    expect(dashboardScopeKey(undefined, undefined, { drill: { category: "a:b", sub: "c" } }))
      .not.toBe(dashboardScopeKey(undefined, undefined, { drill: { category: "a", sub: "b:c" } }));
  });

  it("keeps a literal placeholder distinct from an absent merchant", () => {
    expect(dashboardScopeKey(undefined, undefined, { drill: { merchant: "-" } }))
      .not.toBe(dashboardScopeKey(undefined, undefined));
  });
});
