import { describe, expect, it } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

import { buildDashboardBudgetGroups } from "@/lib/dashboard-budget-groups";
import {
  loadOverviewWidgetData,
} from "@/lib/dashboard-widgets-data";
import { parseDate } from "@/lib/date-utils";
import { parseExtraMonthly, loadDebtPlannerData } from "@/lib/debt-data";

describe("buildDashboardBudgetGroups default-flexible branch", () => {
  it("buckets an envelope whose category has no budget into flexible", () => {
    const groups = buildDashboardBudgetGroups([], [
      {
        category: "NoBudgetCat",
        monthlyLimit: 50,
        spent: 10,
        remaining: 40,
        projectedSpend: 10,
        status: "on-track",
        lastMonthSpend: 0,
        threeMonthAverage: 0,
        carry: 0,
        effectiveLimit: 50,
      },
    ]);
    expect(groups).toMatchObject([{ key: "flexible", monthlyLimit: 50, spent: 10 }]);
  });
});

describe("loadOverviewWidgetData spendingCompare branch", () => {
  it("loads cumulative spend when the spendingCompare widget is visible", async () => {
    const supabase = clientStub({
      transactions: {
        data: [
          {
            id: "t1",
            user_id: "user-1",
            account_id: "acc-1",
            date: "2026-07-10",
            amount: 50,
            pfc_primary: "FOOD_AND_DRINK",
            pending: false,
          },
        ],
      },
      accounts: { data: [] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    }) as never;

    const result = await loadOverviewWidgetData(supabase, {
      month: "2026-07",
      today: "2026-07-15",
      userId: "user-1",
      household: false,
      visible: ["spendingCompare"],
      accounts: [],
    });

    expect(result.cumulativeSpend.days).toBeDefined();
    expect(result.investments).toBeNull();
  });
});

describe("parseDate nullish segment branches", () => {
  it("fills missing month and day from a bare year", () => {
    expect(parseDate("2025").getUTCFullYear()).toBe(2025);
    expect(parseDate("2025-03").getUTCMonth()).toBe(2);
  });
});

describe("debt-data uncovered branches", () => {
  it("treats an overflowing numeric string as non-finite extra payment", () => {
    expect(parseExtraMonthly("9".repeat(400))).toBe(0);
  });

  it("handles a row with a null type and a liability with a null apr", async () => {
    const client = clientStub({
      accounts: {
        data: [
          { id: "null-type", name: "Unknown", type: null, subtype: null, current_balance: 100, apr: null },
          { id: "loan-null-apr", name: "Loan", type: "loan", subtype: null, current_balance: 2000, apr: null },
        ],
      },
    });
    const result = await loadDebtPlannerData(client as never, {
      scope: { kind: "mine", ownerUserId: "user-1" },
      extraMonthly: 0,
    });
    expect(result.debts.map((d) => d.id)).toEqual(["loan-null-apr"]);
    expect(result.debts[0].aprAssumed).toBe(true);
  });
});
