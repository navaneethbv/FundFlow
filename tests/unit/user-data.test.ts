import { describe, expect, it, vi } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

let investmentsEnabled = true;
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => investmentsEnabled,
}));

import {
  collectUserData,
  countUserDataRows,
} from "@/lib/user-data";

describe("lib/user-data", () => {
  it("collects every user-owned section scoped to the caller", async () => {
    const supabase = clientStub({
      accounts: { data: [{ name: "Checking" }] },
      shared_expenses: { data: [{ description: "Dinner" }] },
      households: { data: [{ name: "Home" }] },
    });

    const sections = await collectUserData(supabase as never, "u1");

    expect(sections.accounts).toEqual([{ name: "Checking" }]);
    expect(sections.shared_expenses).toEqual([{ description: "Dinner" }]);
    expect(sections.households).toEqual([{ name: "Home" }]);
    expect(supabase.scopedToUser("accounts", "u1")).toBe(true);
    expect(supabase.scopedToUser("transactions", "u1")).toBe(true);
    expect(supabase.scopedToUser("households", "u1")).toBe(false);
  });

  it("scopes households by owner and shared expenses by involvement", async () => {
    const supabase = clientStub();

    await collectUserData(supabase as never, "u1");

    const households = supabase.callsOn("households");
    expect(households).toContainEqual(
      expect.objectContaining({ method: "eq", args: ["owner_user_id", "u1"] }),
    );
    const shared = supabase.callsOn("shared_expenses");
    expect(shared).toContainEqual(
      expect.objectContaining({
        method: "or",
        args: ["paid_by.eq.u1,owed_user_id.eq.u1"],
      }),
    );
  });

  it("skips investment tables when the feature is off", async () => {
    investmentsEnabled = false;
    const supabase = clientStub();

    const sections = await collectUserData(supabase as never, "u1");

    expect(sections.holdings).toEqual([]);
    expect(sections.holding_snapshots).toEqual([]);
    expect(sections.securities).toEqual([]);
    expect(sections.investment_transactions).toEqual([]);
    expect(supabase.callsOn("holdings")).toHaveLength(0);
  });

  it("coerces null query data to empty arrays", async () => {
    investmentsEnabled = true;
    const supabase = clientStub({ accounts: { data: null } });

    const sections = await collectUserData(supabase as never, "u1");

    expect(sections.accounts).toEqual([]);
    expect(sections.budgets).toEqual([]);
  });

  it("throws when any owned query errors", async () => {
    investmentsEnabled = true;
    const supabase = clientStub({
      budgets: { error: { message: "select failed" } },
    });

    await expect(collectUserData(supabase as never, "u1")).rejects.toThrow(
      "select failed",
    );
  });

  it("paginates tables with more than 1,000 rows across multiple pages", async () => {
    investmentsEnabled = false;
    const manyAccounts = Array.from({ length: 1005 }, (_, i) => ({ id: `acc-${i}`, name: `Account ${i}` }));
    const supabase = clientStub({
      accounts: { data: manyAccounts },
    });

    const sections = await collectUserData(supabase as never, "u1");
    expect(sections.accounts).toHaveLength(1005);
  });

  it("counts rows across every section", () => {
    expect(
      countUserDataRows({
        accounts: [{ id: 1 }],
        budgets: [],
        transactions: [{ id: 2 }, { id: 3 }],
      }),
    ).toBe(3);
  });
});
