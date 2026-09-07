import { describe, expect, it, vi } from "vitest";
import { getDashboardData } from "@/lib/dashboard";
import { resolveViewerToday } from "@/lib/report-period";

function dashboardClient() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  const mockFrom = vi.fn((table: string) => {
    if (table === "accounts") {
      const accountChain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
        accountChain[m] = () => accountChain;
      }
      accountChain.then = (resolve: (v: unknown) => unknown) =>
        resolve({
          data: [
            {
              id: "cash",
              name: "Cash",
              type: "depository",
              current_balance: 2000,
              plaid_item_id: "item-1",
            },
          ],
          error: null,
        });
      return accountChain;
    }
    if (table === "net_worth_snapshots") {
      const snapChain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
        snapChain[m] = () => snapChain;
      }
      snapChain.then = (resolve: (v: unknown) => unknown) =>
        resolve({
          data: [{ snapshot_month: "2026-09-01", assets: 1000, liabilities: 100 }],
          error: null,
        });
      return snapChain;
    }
    return chain;
  });
  return { from: mockFrom };
}

describe("M-11 viewer-day threading", () => {
  it("keys the open month from options.today, not the server clock", async () => {
    const october = await getDashboardData(dashboardClient() as never, undefined, undefined, "u1", {
      today: "2026-10-01",
    });
    expect(october.selectedMonth).toBe("2026-10");
    expect(october.netWorthHistory.at(-1)?.month).toBe("2026-10");
    expect(october.netWorthHistory.at(-1)?.netWorth).toBe(
      october.netWorthSnapshot.netWorth,
    );

    const september = await getDashboardData(dashboardClient() as never, undefined, undefined, "u1", {
      today: "2026-09-30",
    });
    expect(september.selectedMonth).toBe("2026-09");
    expect(september.netWorthHistory.at(-1)?.month).toBe("2026-09");
  });
});

describe("resolveViewerToday", () => {
  function client(timezone: string | null | undefined, throwOnRead = false) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              if (throwOnRead) return Promise.reject(new Error("db down"));
              return Promise.resolve({ data: timezone === undefined ? null : { timezone } });
            },
          }),
        }),
      }),
    };
  }

  // 2026-09-07T02:00Z is still Sep 6 in Los Angeles.
  const reference = new Date("2026-09-07T02:00:00Z");

  it("resolves the profile-timezone day", async () => {
    await expect(
      resolveViewerToday(client("America/Los_Angeles") as never, "u1", reference),
    ).resolves.toBe("2026-09-06");
  });

  it("falls back to the UTC day without a profile, timezone, user, or on error", async () => {
    await expect(resolveViewerToday(client(null) as never, "u1", reference)).resolves.toBe(
      "2026-09-07",
    );
    await expect(resolveViewerToday(client("America/Los_Angeles") as never, undefined, reference)).resolves.toBe(
      "2026-09-07",
    );
    await expect(resolveViewerToday(client("America/Los_Angeles", true) as never, "u1", reference)).resolves.toBe(
      "2026-09-07",
    );
  });
});
