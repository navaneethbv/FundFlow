import { describe, expect, it } from "vitest";
import {
  buildDebtPlannerData,
  loadDebtPlannerData,
  parseDebtStrategy,
  parseExtraMonthly,
} from "@/lib/debt-data";
import { clientStub } from "../fixtures/supabase-query";

describe("debt planner URL input", () => {
  it.each([
    ["avalanche", "avalanche"],
    ["snowball", "snowball"],
    [["snowball", "avalanche"], "snowball"],
    ["highest-interest", "avalanche"],
    [undefined, "avalanche"],
  ] as const)("normalizes strategy %j to %s", (input, expected) => {
    expect(parseDebtStrategy(input)).toBe(expected);
  });

  it.each([
    ["125.50", 125.5],
    [["40", "90"], 40],
    ["-1", 0],
    ["Infinity", 0],
    ["12x", 0],
    [undefined, 0],
  ] as const)("normalizes extra payment %j to %s", (input, expected) => {
    expect(parseExtraMonthly(input)).toBe(expected);
  });
});

describe("buildDebtPlannerData", () => {
  it("carries balances owed through and discloses each unknown APR", () => {
    const result = buildDebtPlannerData(
      [
        { id: "card", name: "Travel card", balance: 2000, apr: 19.5 },
        { id: "loan", name: "Student loan", balance: 5000, apr: null },
      ],
      100,
    );

    expect(result.debts).toEqual([
      {
        id: "card",
        name: "Travel card",
        balance: 2000,
        apr: 19.5,
        aprAssumed: false,
        minimumPayment: 40,
      },
      {
        id: "loan",
        name: "Student loan",
        balance: 5000,
        apr: 22,
        aprAssumed: true,
        minimumPayment: 100,
      },
    ]);
    expect(result.totalBalance).toBe(7000);
    expect(result.totalMonthlyBudget).toBe(240);
    // Plan identity is the account id, not the display name — see lib/debt-data.ts.
    expect(result.avalanche?.order).toEqual(["loan", "card"]);
    expect(result.snowball?.order).toEqual(["card", "loan"]);
  });

  it("excludes an overpaid card instead of reading its credit as debt", () => {
    const result = buildDebtPlannerData(
      [
        { id: "card", name: "Travel card", balance: -2000, apr: 19.5 },
        { id: "loan", name: "Student loan", balance: 5000, apr: null },
      ],
      0,
    );

    expect(result.debts.map((debt) => debt.id)).toEqual(["loan"]);
    expect(result.totalBalance).toBe(5000);
  });

  it("returns an explicit empty state without manufacturing a projection", () => {
    expect(buildDebtPlannerData([], 500)).toEqual({
      debts: [],
      totalBalance: 0,
      totalMonthlyBudget: 0,
      avalanche: null,
      snowball: null,
    });
  });

  it("returns non-converging projections as null", () => {
    const result = buildDebtPlannerData(
      [{ id: "trap", name: "High-interest loan", balance: 10000, apr: 99.99 }],
      0,
    );

    expect(result.totalMonthlyBudget).toBe(200);
    expect(result.avalanche).toBeNull();
    expect(result.snowball).toBeNull();
  });
});

describe("loadDebtPlannerData", () => {
  const rows = [
    {
      id: "card",
      user_id: "user-1",
      name: "Card",
      type: "credit",
      subtype: "credit card",
      current_balance: "1200.50",
      apr: 18,
    },
    {
      id: "cash",
      user_id: "user-1",
      name: "Checking",
      type: "depository",
      subtype: "checking",
      current_balance: 4000,
      apr: null,
    },
  ];

  it("scopes mine queries to the owner and filters non-liabilities", async () => {
    const client = clientStub({ accounts: { data: rows } });
    const result = await loadDebtPlannerData(client as never, {
      scope: { kind: "mine", ownerUserId: "user-1" },
      extraMonthly: 50,
    });

    expect(client.scopedToUser("accounts", "user-1")).toBe(true);
    expect(result.debts.map((debt) => debt.id)).toEqual(["card"]);
    expect(result.totalMonthlyBudget).toBe(75);
  });

  it("uses RLS-visible rows without an owner filter for household scope", async () => {
    const client = clientStub({ accounts: { data: rows } });
    await loadDebtPlannerData(client as never, {
      scope: { kind: "household", householdId: "household-1" },
      extraMonthly: 0,
    });

    expect(client.scopedToUser("accounts", "user-1")).toBe(false);
  });

  it("surfaces account-query failures", async () => {
    const client = clientStub({ accounts: { error: { code: "42501" } } });

    await expect(
      loadDebtPlannerData(client as never, {
        scope: { kind: "mine", ownerUserId: "user-1" },
        extraMonthly: 0,
      }),
    ).rejects.toThrow("debt_accounts_query_failed:42501");
  });
});
