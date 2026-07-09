import { describe, it, expect } from "vitest";
import { getGoals } from "@/lib/goals";

/**
 * Guards the service-client path: getGoals relies on RLS for the user-scoped
 * client, but the notification cron (processNotificationsForUser) calls it with
 * the RLS-bypassing service client, so it must apply an explicit user_id filter
 * when given a userId. A recording mock captures every .eq() call.
 */
function makeSupabase(eqCalls: Array<[string, string]>) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    order: () => chain,
    eq: (column: string, value: string) => {
      eqCalls.push([column, value]);
      return chain;
    },
    then: (resolve: (value: { data: unknown[] }) => unknown) => resolve({ data: [] }),
  });
  return { from: () => chain } as never;
}

describe("getGoals user scoping", () => {
  it("filters by user_id when a userId is supplied", async () => {
    const eqCalls: Array<[string, string]> = [];
    await getGoals(makeSupabase(eqCalls), "user-9");
    expect(eqCalls).toContainEqual(["user_id", "user-9"]);
  });

  it("adds no user_id filter when no userId is supplied (RLS path)", async () => {
    const eqCalls: Array<[string, string]> = [];
    await getGoals(makeSupabase(eqCalls));
    expect(eqCalls.some(([column]) => column === "user_id")).toBe(false);
  });
});
