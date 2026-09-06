import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDashboardData } from "@/lib/dashboard";

/**
 * The Dashboard's live open-month net worth overwrites the stored monthly
 * snapshot, so it has to be composed from exactly the same balance sheet the
 * snapshot writer and the Accounts page use: connected accounts plus manual
 * accounts, minus the user's explicit exclusions. It once counted connected
 * balances only, silently dropping a manual asset and re-adding an excluded
 * account.
 */
const CONNECTED_CASH = {
  id: "a1",
  user_id: "user-1",
  name: "Everyday Checking",
  official_name: null,
  mask: "1234",
  type: "depository",
  subtype: "checking",
  current_balance: 1000,
  available_balance: 1000,
  credit_limit: null,
  iso_currency_code: "USD",
  plaid_item_id: "item-1",
  apr: null,
};

function makeSupabase(
  tables: Record<string, unknown[]>,
  errors: Record<string, unknown> = {},
): SupabaseClient {
  const build = (table: string) => {
    const rows = tables[table] ?? [];
    const error = errors[table] ?? null;
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "lt", "in", "is", "order", "range", "limit"]) {
      chain[method] = () => chain;
    }
    chain.maybeSingle = () =>
      Promise.resolve({ data: error ? null : rows[0] ?? null, error });
    chain.single = chain.maybeSingle;
    chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: error ? null : rows, error }).then(resolve);
    return chain;
  };
  return { from: (table: string) => build(table) } as unknown as SupabaseClient;
}

describe("dashboard net-worth composition", () => {
  it("adds an included manual asset to the connected balances", async () => {
    const data = await getDashboardData(
      makeSupabase({
        accounts: [CONNECTED_CASH],
        manual_accounts: [
          { id: "m1", name: "Vested equity", account_type: "other", balance: 500, include_in_net_worth: true },
        ],
      }),
      undefined,
      undefined,
      "user-1",
    );

    expect(data.netWorthSnapshot.assets).toBe(1500);
    expect(data.netWorthSnapshot.netWorth).toBe(1500);
  });

  it("counts a manual liability against net worth", async () => {
    const data = await getDashboardData(
      makeSupabase({
        accounts: [CONNECTED_CASH],
        manual_accounts: [
          { id: "m1", name: "Family loan", account_type: "loan", balance: 400, include_in_net_worth: true },
        ],
      }),
      undefined,
      undefined,
      "user-1",
    );

    expect(data.netWorthSnapshot.assets).toBe(1000);
    expect(data.netWorthSnapshot.liabilities).toBe(400);
    expect(data.netWorthSnapshot.netWorth).toBe(600);
  });

  it("drops a manual account the user excluded with its own flag", async () => {
    const data = await getDashboardData(
      makeSupabase({
        accounts: [CONNECTED_CASH],
        manual_accounts: [
          { id: "m1", name: "Collectibles", account_type: "other", balance: 500, include_in_net_worth: false },
        ],
      }),
      undefined,
      undefined,
      "user-1",
    );

    expect(data.netWorthSnapshot.assets).toBe(1000);
  });

  it("drops a connected account listed in the Accounts page exclusions", async () => {
    const data = await getDashboardData(
      makeSupabase({
        accounts: [CONNECTED_CASH],
        manual_accounts: [],
        profiles: [{ dashboard_prefs: { accountsPage: { excludedNetWorthIds: ["a1"] } } }],
      }),
      undefined,
      undefined,
      "user-1",
    );

    expect(data.netWorthSnapshot.assets).toBe(0);
    expect(data.netWorthSnapshot.netWorth).toBe(0);
  });

  it("reports a balance sheet for a manual-only user with no connected accounts", async () => {
    const data = await getDashboardData(
      makeSupabase({
        accounts: [],
        manual_accounts: [
          { id: "m1", name: "Cash savings", account_type: "depository", balance: 250, include_in_net_worth: true },
        ],
      }),
      undefined,
      undefined,
      "user-1",
    );

    expect(data.netWorthSnapshot.assets).toBe(250);
    // The open month is still published as a live point, which a
    // connected-accounts-only guard used to suppress entirely.
    expect(data.netWorthHistory.at(-1)?.netWorth).toBe(250);
  });

  it("surfaces a failed manual-account read instead of reporting a smaller balance sheet", async () => {
    await expect(
      getDashboardData(
        makeSupabase(
          { accounts: [CONNECTED_CASH] },
          { manual_accounts: { message: "permission denied for table manual_accounts" } },
        ),
        undefined,
        undefined,
        "user-1",
      ),
    ).rejects.toMatchObject({ message: "permission denied for table manual_accounts" });
  });

  it("surfaces a failed exclusion-preference read the same way", async () => {
    await expect(
      getDashboardData(
        makeSupabase(
          { accounts: [CONNECTED_CASH], manual_accounts: [] },
          { profiles: { message: "permission denied for table profiles" } },
        ),
        undefined,
        undefined,
        "user-1",
      ),
    ).rejects.toMatchObject({ message: "permission denied for table profiles" });
  });
});
