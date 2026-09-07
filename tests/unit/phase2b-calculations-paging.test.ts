import { describe, expect, it, vi } from "vitest";
import { matchesBudgetCategory } from "@/lib/finance-domain";
import {
  buildBudgetEnvelopes,
  expandRecurring,
  forecastCashFlow,
  groupRecurringByWeek,
} from "@/lib/planning";
import { buildBudgetPage } from "@/lib/budget-page";
import { buildWeeklyReportModel } from "@/lib/weekly-report";
import { getDashboardData } from "@/lib/dashboard";
import { occurrenceDatesInWindow } from "@/lib/recurring-page";
import { detectPaychecks } from "@/lib/insights";

function canonicalTxn(
  id: string,
  date: string,
  signedAmount: number,
  categoryKey: string,
  groupKey: string,
  flow: "expense" | "income" = "expense",
) {
  return {
    id,
    sourceTransactionId: id,
    date,
    signedAmount,
    flow,
    merchant: "Store",
    groupKey,
    categoryKey,
    accountId: "acc-1",
    manualAccountId: null,
    pending: false,
    source: "plaid" as const,
  };
}

describe("M-1 canonical budget matching", () => {
  it("matches case-insensitively on detailed or group keys", () => {
    expect(
      matchesBudgetCategory("food_and_drink_groceries", {
        categoryKey: "FOOD_AND_DRINK_GROCERIES",
        groupKey: "FOOD_AND_DRINK",
      }),
    ).toBe(true);
    expect(
      matchesBudgetCategory("ENTERTAINMENT", {
        categoryKey: "ENTERTAINMENT_SPORTING_EVENTS",
        groupKey: "ENTERTAINMENT",
      }),
    ).toBe(true);
    expect(matchesBudgetCategory("DINING", "dining")).toBe(true);
    expect(
      matchesBudgetCategory("FOOD_AND_DRINK_GROCERIES", {
        categoryKey: "TRAVEL",
        groupKey: "TRAVEL",
      }),
    ).toBe(false);
  });

  it("gives identical spent for a detailed-key and a group-key budget on every surface", () => {
    const spendRows = [
      {
        category: "FOOD_AND_DRINK",
        amount: 700,
        groupKey: "FOOD_AND_DRINK",
        categoryKey: "FOOD_AND_DRINK_GROCERIES",
      },
    ];
    const detailed = buildBudgetEnvelopes({
      budgets: [{ category: "food_and_drink_groceries", monthlyLimit: 600 }],
      currentSpend: spendRows,
      previousSpend: [],
      dayOfMonth: 30,
      daysInMonth: 30,
    });
    const grouped = buildBudgetEnvelopes({
      budgets: [{ category: "FOOD_AND_DRINK", monthlyLimit: 600 }],
      currentSpend: spendRows,
      previousSpend: [],
      dayOfMonth: 30,
      daysInMonth: 30,
    });
    expect(detailed[0]?.spent).toBe(700);
    expect(grouped[0]?.spent).toBe(700);
    expect(detailed[0]?.status).toBe("over");
    expect(grouped[0]?.status).toBe("over");

    const txns = [
      canonicalTxn("t1", "2026-07-05", 700, "FOOD_AND_DRINK_GROCERIES", "FOOD_AND_DRINK"),
    ];
    const page = buildBudgetPage({
      month: "2026-07",
      budgets: [
        { id: "b1", category: "food_and_drink_groceries", monthly_limit: 600, group_name: "flexible" },
      ],
      txns,
    });
    const line = page.sections
      .flatMap((section) => section.lines)
      .find((row) => row.budgetId === "b1");
    expect(line?.actual).toBe(700);

    const report = buildWeeklyReportModel({
      userId: "user-1",
      userEmail: "person@example.com",
      period: {
        kind: "weekly",
        start: "2026-07-01",
        end: "2026-07-07",
        previousStart: "2026-06-24",
        previousEnd: "2026-06-30",
      },
      transactions: [
        {
          id: "t1",
          date: "2026-07-05",
          amount: 700,
          merchantName: "Store",
          name: "GROCERIES",
          category: "FOOD_AND_DRINK",
          detailedCategory: "FOOD_AND_DRINK_GROCERIES",
          accountId: "checking",
        },
      ],
      accounts: [{ id: "checking", name: "Checking", type: "depository", plaidItemId: "item-1" }],
      institutions: [{ id: "item-1", name: "Bank" }],
      budgets: [{ category: "FOOD_AND_DRINK", monthlyLimit: 600 }],
      merchantRules: [],
      splits: [],
      linkedRefundTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
    });
    expect(report.budgets[0]?.spent).toBe(700);
  });
});

describe("M-2 anchor-preserving month arithmetic", () => {
  it("keeps the 31st anchored across February", () => {
    const dates = occurrenceDatesInWindow(
      "2026-01-31",
      { unit: "months", amount: 1 },
      "2026-01-01",
      "2026-05-01",
    );
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("advances a month-end payday from its deposit anchor", () => {
    const { paychecks } = detectPaychecks({
      incomeStreams: [{ name: "Salary", amount: 3000, frequency: "monthly" }],
      incomeTransactions: [{ merchant: "Salary", date: "2026-01-31", amount: -3000 }],
      asOf: "2026-03-01",
    });
    expect(paychecks[0]?.nextPayDate).toBe("2026-03-31");
  });
});

describe("M-4 recurring expansion", () => {
  it("advances a past anchor instead of dropping it from the forecast", () => {
    const forecast = forecastCashFlow({
      startingBalance: 3000,
      asOf: "2026-09-06",
      horizonDays: 40,
      items: [
        { name: "Rent", amount: 2000, itemType: "expense", frequency: "monthly", nextDate: "2026-08-01" },
      ],
      lowBalanceThreshold: 500,
    });
    const dates = forecast.events.map((event) => event.date);
    expect(dates).toContain("2026-10-01");
    expect(forecast.projectedBalance).toBe(1000);
  });

  it("expands past anchors in the weekly grouping", () => {
    const groups = groupRecurringByWeek(
      [
        { name: "Rent", amount: 2000, itemType: "expense", frequency: "monthly", nextDate: "2026-08-01" },
      ],
      "2026-09-06",
      40,
    );
    const dates = groups.flatMap((group) => group.items.map((item) => item.nextDate));
    expect(dates).toContain("2026-10-01");
  });

  it("expands a once item only inside the window", () => {
    const item = { name: "One-off", amount: 50, itemType: "expense" as const, frequency: "once" as const, nextDate: "2026-09-10" };
    expect(expandRecurring(item, "2026-09-06", "2026-09-20")).toEqual(["2026-09-10"]);
    expect(expandRecurring(item, "2026-09-11", "2026-09-20")).toEqual([]);
  });
});

describe("A-5 paged dashboard reads", () => {
  it("totals more rows than one PostgREST page", async () => {
    const rows = Array.from({ length: 1200 }, (_, index) => ({
      id: `txn-${index}`,
      date: "2026-09-05",
      amount: 1,
      merchant_name: "Store",
      name: "GROCERIES",
      pfc_primary: "FOOD_AND_DRINK",
      pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
      account_id: "acc-1",
      user_id: "user-1",
      plaid_transaction_id: `plaid-${index}`,
    }));
    const mockFrom = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      let from = 0;
      let to = Number.MAX_SAFE_INTEGER;
      for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "single"]) {
        chain[m] = () => chain;
      }
      chain.range = (a: number, b: number) => {
        from = a;
        to = b;
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (table === "transactions") {
          return resolve({ data: rows.slice(from, to + 1), error: null });
        }
        if (table === "linked_transfers") {
          return resolve({
            data: [{ out_transaction_id: "txn-0", in_transaction_id: "txn-1" }],
            error: null,
          });
        }
        if (table === "accounts") {
          return resolve({
            data: [{ id: "acc-1", name: "Checking", type: "depository", current_balance: 5000, plaid_item_id: "item-1" }],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      };
      return chain;
    });
    const data = await getDashboardData(
      { from: mockFrom } as never,
      undefined,
      "2026-09",
      "user-1",
    );
    const food = data.categoryBreakdown.find((row) => row.category === "FOOD_AND_DRINK");
    // 1,200 rows paged in full, minus the two seeded as a linked transfer
    // pair (which also exercises the transfer-row mapping).
    expect(food?.amount).toBe(1198);
  });

  it("throws instead of rendering zeros when a Stage-1 read fails", async () => {
    const mockFrom = vi.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
        chain[m] = () => chain;
      }
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: { message: "db down" } });
      return chain;
    });
    await expect(
      getDashboardData({ from: mockFrom } as never, undefined, "2026-09", "user-1"),
    ).rejects.toMatchObject({ message: "db down" });
  });
});
