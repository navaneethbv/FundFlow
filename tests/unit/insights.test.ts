import { describe, expect, it } from "vitest";
import {
  buildCategoryOverrideMap,
  computeMerchantPriceDrift,
  computeSinkingFunds,
  projectNetWorth,
  computeRunwayMonths,
  computeSafeToSpend,
  computeSavingsRateSeries,
  computeSettleUp,
  detectNetWorthMilestones,
  detectPaychecks,
  diffRecurringStreams,
  overrideCategory,
  splitEssentialsByMonth,
  suggestBudgets,
} from "@/lib/insights";

describe("splitEssentialsByMonth", () => {
  it("splits spend into essentials and discretionary by primary category", () => {
    const rows = [
      { month: "2026-07", pfcPrimary: "RENT_AND_UTILITIES", pfcDetailed: null, amount: 1500 },
      { month: "2026-07", pfcPrimary: "ENTERTAINMENT", pfcDetailed: null, amount: 200 },
      { month: "2026-07", pfcPrimary: "MEDICAL", pfcDetailed: null, amount: 80 },
    ];
    const result = splitEssentialsByMonth(rows, ["2026-07"]);
    expect(result).toEqual([
      { month: "2026-07", essentials: 1580, discretionary: 200 },
    ]);
  });

  it("treats groceries as essential while restaurants stay discretionary", () => {
    const rows = [
      { month: "2026-07", pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: "FOOD_AND_DRINK_GROCERIES", amount: 400 },
      { month: "2026-07", pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: "FOOD_AND_DRINK_RESTAURANT", amount: 150 },
    ];
    const result = splitEssentialsByMonth(rows, ["2026-07"]);
    expect(result).toEqual([
      { month: "2026-07", essentials: 400, discretionary: 150 },
    ]);
  });

  it("returns zeros for months with no spend and preserves month order", () => {
    const result = splitEssentialsByMonth([], ["2026-06", "2026-07"]);
    expect(result).toEqual([
      { month: "2026-06", essentials: 0, discretionary: 0 },
      { month: "2026-07", essentials: 0, discretionary: 0 },
    ]);
  });

  it("rounds each bucket to cents", () => {
    const rows = [
      { month: "2026-07", pfcPrimary: "MEDICAL", pfcDetailed: null, amount: 10.111 },
      { month: "2026-07", pfcPrimary: "MEDICAL", pfcDetailed: null, amount: 10.111 },
    ];
    const result = splitEssentialsByMonth(rows, ["2026-07"]);
    expect(result[0]!.essentials).toBe(20.22);
  });
});

describe("computeSavingsRateSeries", () => {
  it("computes the per-month savings rate as a percentage", () => {
    const income = [
      { month: "2026-06", amount: 5000 },
      { month: "2026-07", amount: 4000 },
    ];
    const spending = [
      { month: "2026-06", amount: 4000 },
      { month: "2026-07", amount: 3000 },
    ];
    expect(computeSavingsRateSeries(income, spending)).toEqual([
      { month: "2026-06", rate: 20 },
      { month: "2026-07", rate: 25 },
    ]);
  });

  it("floors the rate at zero when spending exceeds income", () => {
    const income = [{ month: "2026-07", amount: 1000 }];
    const spending = [{ month: "2026-07", amount: 1500 }];
    expect(computeSavingsRateSeries(income, spending)).toEqual([
      { month: "2026-07", rate: 0 },
    ]);
  });

  it("reports zero for months with no income", () => {
    const income = [{ month: "2026-07", amount: 0 }];
    const spending = [{ month: "2026-07", amount: 500 }];
    expect(computeSavingsRateSeries(income, spending)).toEqual([
      { month: "2026-07", rate: 0 },
    ]);
  });
});

describe("computeRunwayMonths", () => {
  it("divides liquid balance by the median monthly essentials", () => {
    expect(
      computeRunwayMonths({
        liquidBalance: 9000,
        monthlyEssentials: [2000, 3000, 2500],
      }),
    ).toBe(3.6);
  });

  it("ignores zero-essentials months (pre-history gaps) when finding the median", () => {
    expect(
      computeRunwayMonths({
        liquidBalance: 4000,
        monthlyEssentials: [0, 0, 2000],
      }),
    ).toBe(2);
  });

  it("returns null when there is no essentials history or no balance", () => {
    expect(
      computeRunwayMonths({ liquidBalance: 5000, monthlyEssentials: [0, 0] }),
    ).toBeNull();
    expect(
      computeRunwayMonths({ liquidBalance: null, monthlyEssentials: [2000] }),
    ).toBeNull();
  });
});

describe("detectPaychecks", () => {
  const deposits = [
    { date: "2026-06-26", merchant: "Acme Payroll", amount: -2400 },
    { date: "2026-07-10", merchant: "Acme Payroll", amount: -2400 },
    { date: "2026-07-01", merchant: "Side Gig LLC", amount: -300 },
  ];

  it("anchors the next pay date to the latest matching deposit and cadence", () => {
    const result = detectPaychecks({
      incomeStreams: [
        { name: "Acme Payroll", amount: 2400, frequency: "biweekly" },
      ],
      incomeTransactions: deposits,
      asOf: "2026-07-20",
    });
    expect(result.paychecks).toEqual([
      {
        name: "Acme Payroll",
        amount: 2400,
        frequency: "biweekly",
        lastPaidDate: "2026-07-10",
        nextPayDate: "2026-07-24",
      },
    ]);
  });

  it("picks the largest stream with a known next date as the primary paycheck", () => {
    const result = detectPaychecks({
      incomeStreams: [
        { name: "Side Gig LLC", amount: 300, frequency: "monthly" },
        { name: "Acme Payroll", amount: 2400, frequency: "biweekly" },
      ],
      incomeTransactions: deposits,
      asOf: "2026-07-20",
    });
    expect(result.primary?.name).toBe("Acme Payroll");
    expect(result.primary?.nextPayDate).toBe("2026-07-24");
  });

  it("keeps streams without matching deposits but never promotes them to primary", () => {
    const result = detectPaychecks({
      incomeStreams: [
        { name: "Mystery Employer", amount: 9000, frequency: "monthly" },
        { name: "Acme Payroll", amount: 2400, frequency: "biweekly" },
      ],
      incomeTransactions: deposits,
      asOf: "2026-07-20",
    });
    const mystery = result.paychecks.find((p) => p.name === "Mystery Employer");
    expect(mystery?.lastPaidDate).toBeNull();
    expect(mystery?.nextPayDate).toBeNull();
    expect(result.primary?.name).toBe("Acme Payroll");
  });

  it("advances monthly cadence by calendar months past asOf", () => {
    const result = detectPaychecks({
      incomeStreams: [{ name: "Side Gig LLC", amount: 300, frequency: "monthly" }],
      incomeTransactions: deposits,
      asOf: "2026-08-02",
    });
    expect(result.paychecks[0]!.nextPayDate).toBe("2026-09-01");
  });

  it("treats a paycheck due today as the next one", () => {
    const result = detectPaychecks({
      incomeStreams: [{ name: "Acme Payroll", amount: 2400, frequency: "biweekly" }],
      incomeTransactions: deposits,
      asOf: "2026-07-24",
    });
    expect(result.paychecks[0]!.nextPayDate).toBe("2026-07-24");
  });
});

describe("computeSafeToSpend", () => {
  const bills = [
    { date: "2026-07-21", name: "Rent", amount: 1500 },
    { date: "2026-07-23", name: "Utilities", amount: 120 },
    { date: "2026-07-24", name: "Insurance", amount: 200 },
    { date: "2026-08-01", name: "Gym", amount: 40 },
  ];

  it("subtracts bills due before the next paycheck", () => {
    const result = computeSafeToSpend({
      cashBalance: 3000,
      asOf: "2026-07-20",
      nextPayDate: "2026-07-24",
      upcomingExpenses: bills,
    });
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(3000 - 1500 - 120);
    expect(result!.upcomingBillsTotal).toBe(1620);
    expect(result!.horizonEnd).toBe("2026-07-24");
    expect(result!.anchor).toBe("paycheck");
  });

  it("includes a bill due today and ignores bills before asOf", () => {
    const result = computeSafeToSpend({
      cashBalance: 1000,
      asOf: "2026-07-23",
      nextPayDate: "2026-07-24",
      upcomingExpenses: bills,
    });
    expect(result!.upcomingBillsTotal).toBe(120);
  });

  it("falls back to a 14-day window when no payday is known", () => {
    const result = computeSafeToSpend({
      cashBalance: 3000,
      asOf: "2026-07-20",
      nextPayDate: null,
      upcomingExpenses: bills,
    });
    expect(result!.horizonEnd).toBe("2026-08-03");
    expect(result!.anchor).toBe("window");
    expect(result!.upcomingBillsTotal).toBe(1500 + 120 + 200 + 40);
  });

  it("goes negative rather than hiding an overdrawn outlook", () => {
    const result = computeSafeToSpend({
      cashBalance: 900,
      asOf: "2026-07-20",
      nextPayDate: "2026-07-24",
      upcomingExpenses: bills,
    });
    expect(result!.amount).toBe(900 - 1620);
  });

  it("returns null without a cash balance", () => {
    expect(
      computeSafeToSpend({
        cashBalance: null,
        asOf: "2026-07-20",
        nextPayDate: "2026-07-24",
        upcomingExpenses: bills,
      }),
    ).toBeNull();
  });
});

describe("diffRecurringStreams", () => {
  const previous = [
    { streamId: "s1", lastAmount: 15.49 },
    { streamId: "s2", lastAmount: 9.99 },
    { streamId: "s3", lastAmount: 60 },
  ];

  it("flags an outflow price hike above the threshold", () => {
    const result = diffRecurringStreams(previous, [
      { streamId: "s1", streamType: "outflow", name: "Netflix", lastAmount: 17.99, isActive: true },
    ]);
    expect(result.priceHikes).toEqual([
      {
        streamId: "s1",
        name: "Netflix",
        previousAmount: 15.49,
        newAmount: 17.99,
        increase: 2.5,
        pctIncrease: 16.1,
      },
    ]);
    expect(result.newStreams).toEqual([]);
  });

  it("ignores sub-threshold wiggle (under $2 and under 5%)", () => {
    const result = diffRecurringStreams(previous, [
      { streamId: "s3", streamType: "outflow", name: "Electric Co", lastAmount: 61.5, isActive: true },
    ]);
    expect(result.priceHikes).toEqual([]);
  });

  it("flags unknown outflow streams as new subscriptions", () => {
    const result = diffRecurringStreams(previous, [
      { streamId: "s9", streamType: "outflow", name: "Peacock", lastAmount: 7.99, isActive: true },
    ]);
    expect(result.newStreams).toEqual([
      { streamId: "s9", name: "Peacock", amount: 7.99 },
    ]);
  });

  it("ignores inflow streams, inactive streams, and price drops", () => {
    const result = diffRecurringStreams(previous, [
      { streamId: "s8", streamType: "inflow", name: "Payroll", lastAmount: 2400, isActive: true },
      { streamId: "s7", streamType: "outflow", name: "Old Box", lastAmount: 20, isActive: false },
      { streamId: "s2", streamType: "outflow", name: "Hulu", lastAmount: 7.99, isActive: true },
    ]);
    expect(result.priceHikes).toEqual([]);
    expect(result.newStreams).toEqual([]);
  });
});

describe("suggestBudgets", () => {
  const history = [
    { month: "2026-04", category: "FOOD_AND_DRINK", amount: 380 },
    { month: "2026-05", category: "FOOD_AND_DRINK", amount: 412 },
    { month: "2026-06", category: "FOOD_AND_DRINK", amount: 405 },
    { month: "2026-05", category: "ENTERTAINMENT", amount: 90 },
    { month: "2026-06", category: "ENTERTAINMENT", amount: 130 },
    { month: "2026-06", category: "TRAVEL", amount: 900 },
  ];

  it("suggests a rounded-up limit from the median for unbudgeted categories", () => {
    const result = suggestBudgets({ history, existingCategories: [] });
    const food = result.find((s) => s.category === "FOOD_AND_DRINK");
    // median 405 → ×1.05 = 425.25 → next $5 step = 430
    expect(food).toEqual({
      category: "FOOD_AND_DRINK",
      suggestedLimit: 430,
      median: 405,
      months: 3,
    });
  });

  it("skips categories that already have budgets", () => {
    const result = suggestBudgets({
      history,
      existingCategories: ["FOOD_AND_DRINK"],
    });
    expect(result.some((s) => s.category === "FOOD_AND_DRINK")).toBe(false);
  });

  it("skips categories with fewer than two months of history", () => {
    const result = suggestBudgets({ history, existingCategories: [] });
    expect(result.some((s) => s.category === "TRAVEL")).toBe(false);
  });

  it("orders suggestions by median spend, largest first", () => {
    const result = suggestBudgets({ history, existingCategories: [] });
    expect(result.map((s) => s.category)).toEqual([
      "FOOD_AND_DRINK",
      "ENTERTAINMENT",
    ]);
  });
});

describe("computeMerchantPriceDrift", () => {
  const txn = (date: string, merchant: string, amount: number) => ({ date, merchant, amount });

  it("compares recent 3-month average charge vs the prior 3 months per merchant", () => {
    const result = computeMerchantPriceDrift({
      txns: [
        txn("2026-02-10", "Power Co", 90),
        txn("2026-03-10", "Power Co", 92),
        txn("2026-04-10", "Power Co", 88),
        txn("2026-05-10", "Power Co", 99),
        txn("2026-06-10", "Power Co", 100),
        txn("2026-07-10", "Power Co", 101),
      ],
      asOfMonth: "2026-07",
    });
    expect(result.items).toHaveLength(1);
    const power = result.items[0]!;
    expect(power.merchant).toBe("Power Co");
    expect(power.earlierAvg).toBe(90);
    expect(power.recentAvg).toBe(100);
    expect(power.driftPct).toBe(11.1);
    expect(result.overallDriftPct).toBe(11.1);
  });

  it("requires at least two charges on each side", () => {
    const result = computeMerchantPriceDrift({
      txns: [
        txn("2026-04-10", "One Off", 50),
        txn("2026-06-10", "One Off", 80),
      ],
      asOfMonth: "2026-07",
    });
    expect(result.items).toEqual([]);
    expect(result.overallDriftPct).toBeNull();
  });

  it("sorts by absolute drift, largest first", () => {
    const result = computeMerchantPriceDrift({
      txns: [
        txn("2026-03-01", "Small", 10), txn("2026-04-01", "Small", 10),
        txn("2026-06-01", "Small", 10.5), txn("2026-07-01", "Small", 10.5),
        txn("2026-03-01", "Big", 100), txn("2026-04-01", "Big", 100),
        txn("2026-06-01", "Big", 150), txn("2026-07-01", "Big", 150),
      ],
      asOfMonth: "2026-07",
    });
    expect(result.items.map((i) => i.merchant)).toEqual(["Big", "Small"]);
  });
});

describe("category overrides", () => {
  it("maps source categories case-insensitively and passes unknowns through", () => {
    const map = buildCategoryOverrideMap([
      { sourceCategory: "food_and_drink", displayCategory: "Eating Out" },
      { sourceCategory: "ENTERTAINMENT", displayCategory: "Eating Out" },
    ]);
    expect(overrideCategory(map, "FOOD_AND_DRINK")).toBe("Eating Out");
    expect(overrideCategory(map, "ENTERTAINMENT")).toBe("Eating Out");
    expect(overrideCategory(map, "TRAVEL")).toBe("TRAVEL");
    expect(overrideCategory(map, null)).toBeNull();
  });

  it("skips blank rows", () => {
    const map = buildCategoryOverrideMap([
      { sourceCategory: "  ", displayCategory: "X" },
      { sourceCategory: "A", displayCategory: "" },
    ]);
    expect(map.size).toBe(0);
  });
});

describe("computeSettleUp", () => {
  it("nets what two people owe each other across shared expenses", () => {
    const result = computeSettleUp([
      { paidBy: "ana", owedBy: "ben", amount: 60 },
      { paidBy: "ben", owedBy: "ana", amount: 25 },
    ]);
    expect(result).toEqual({ from: "ben", to: "ana", amount: 35 });
  });

  it("returns null when settled or empty", () => {
    expect(computeSettleUp([])).toBeNull();
    expect(
      computeSettleUp([
        { paidBy: "ana", owedBy: "ben", amount: 20 },
        { paidBy: "ben", owedBy: "ana", amount: 20 },
      ]),
    ).toBeNull();
  });
});

describe("computeSinkingFunds", () => {
  it("spreads each fund over the months until its due date", () => {
    const result = computeSinkingFunds({
      funds: [
        { name: "Car insurance", targetAmount: 600, dueDate: "2027-01-23" },
        { name: "Holiday gifts", targetAmount: 300, dueDate: "2026-12-23" },
      ],
      asOf: "2026-07-23",
    });
    expect(result.items[0]).toMatchObject({
      name: "Car insurance",
      monthsLeft: 6,
      monthlySetAside: 100,
      dueSoon: false,
    });
    expect(result.items[1]!.monthsLeft).toBe(5);
    expect(result.items[1]!.monthlySetAside).toBe(60);
    expect(result.totalMonthlySetAside).toBe(160);
  });

  it("treats due-now and past-due funds as one month and flags them", () => {
    const result = computeSinkingFunds({
      funds: [
        { name: "Registration", targetAmount: 120, dueDate: "2026-07-30" },
        { name: "Overdue", targetAmount: 90, dueDate: "2026-06-01" },
      ],
      asOf: "2026-07-23",
    });
    expect(result.items.find((f) => f.name === "Registration")).toMatchObject({
      monthsLeft: 1,
      monthlySetAside: 120,
      dueSoon: true,
    });
    expect(result.items.find((f) => f.name === "Overdue")).toMatchObject({
      monthsLeft: 1,
      monthlySetAside: 90,
      dueSoon: true,
    });
  });
});

describe("projectNetWorth", () => {
  it("projects linear growth from monthly savings with no return assumption", () => {
    const series = projectNetWorth({
      currentNetWorth: 1000,
      monthlySavings: 100,
      months: 12,
    });
    expect(series).toHaveLength(12);
    expect(series.at(-1)!.netWorth).toBe(2200);
  });

  it("compounds an optional annual growth rate monthly", () => {
    const series = projectNetWorth({
      currentNetWorth: 10000,
      monthlySavings: 0,
      months: 12,
      annualGrowthPct: 7,
    });
    expect(series.at(-1)!.netWorth).toBeCloseTo(10700, 0);
  });

  it("handles negative savings (drawdown)", () => {
    const series = projectNetWorth({
      currentNetWorth: 1000,
      monthlySavings: -200,
      months: 6,
    });
    expect(series.at(-1)!.netWorth).toBe(-200);
  });
});

describe("detectNetWorthMilestones", () => {
  it("emits unachieved $10k crossings and the first-positive milestone", () => {
    const found = detectNetWorthMilestones({
      history: [
        { month: "2026-06", netWorth: 8000 },
        { month: "2026-07", netWorth: 21000 },
      ],
      achieved: ["networth:positive", "networth:10000"],
    });
    expect(found.map((m) => m.key)).toEqual(["networth:20000"]);
    expect(found[0]!.title).toContain("20,000");
  });

  it("emits nothing without history or below every step", () => {
    expect(detectNetWorthMilestones({ history: [], achieved: [] })).toEqual([]);
    expect(
      detectNetWorthMilestones({
        history: [{ month: "2026-07", netWorth: -500 }],
        achieved: [],
      }),
    ).toEqual([]);
  });
});
