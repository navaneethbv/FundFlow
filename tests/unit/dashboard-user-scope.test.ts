import { describe, it, expect } from "vitest";
import { getDashboardData } from "@/lib/dashboard";

/**
 * Guards the service-client path: getDashboardData relies on RLS for the
 * user-scoped client, but the notification cron calls it with the RLS-bypassing
 * service client, so it must apply an explicit user_id filter when given a
 * userId. A recording mock captures every .eq() call.
 */
function makeSupabase(eqCalls: Array<[string, string]>) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    order: () => chain,
    gte: () => chain,
    lt: () => chain,
    in: () => chain,
    limit: () => chain,
    eq: (column: string, value: string) => {
      eqCalls.push([column, value]);
      return chain;
    },
    maybeSingle: () => Promise.resolve({ data: null }),
    then: (resolve: (value: { data: unknown[] }) => unknown) => resolve({ data: [] }),
  });
  return { from: () => chain } as never;
}

describe("getDashboardData user scoping", () => {
  it("filters every query by user_id when a userId is supplied", async () => {
    const eqCalls: Array<[string, string]> = [];
    await getDashboardData(makeSupabase(eqCalls), undefined, "2026-07", "user-9");
    const userScoped = eqCalls.filter(([column]) => column === "user_id");
    // Applied to the batched stage-1 reads plus the stage-2 transaction window.
    expect(userScoped.length).toBeGreaterThanOrEqual(8);
    expect(userScoped.every(([, value]) => value === "user-9")).toBe(true);
  });

  it("adds no user_id filter when no userId is supplied (RLS path)", async () => {
    const eqCalls: Array<[string, string]> = [];
    await getDashboardData(makeSupabase(eqCalls), undefined, "2026-07");
    expect(eqCalls.some(([column]) => column === "user_id")).toBe(false);
  });
});
