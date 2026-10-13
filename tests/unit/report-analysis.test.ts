import { describe, expect, it } from "vitest";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
import {
  buildReportComparison,
  buildReportSpendingHabits,
  type ReportAnalysisPeriod,
} from "@/lib/report-analysis";

function row(overrides: Partial<CanonicalFinanceTransaction> = {}): CanonicalFinanceTransaction {
  return {
    id: "row", sourceTransactionId: "source", date: "2024-03-01",
    signedAmount: 100, flow: "expense", merchant: "Merchant",
    groupKey: "FOOD_AND_DRINK", categoryKey: "FOOD_AND_DRINK_GROCERIES",
    accountId: "account", manualAccountId: null, pending: false, source: "plaid",
    ...overrides,
  };
}

function period(
  transactions: CanonicalFinanceTransaction[] = [],
  overrides: Partial<ReportAnalysisPeriod> = {},
): ReportAnalysisPeriod {
  return { transactions, startDate: "2024-03-01", endDate: "2024-03-31", currency: "USD", ...overrides };
}

describe("buildReportComparison", () => {
  it("nets refunds, excludes canonical transfers, and reconciles income, spending and net", () => {
    const result = buildReportComparison(period([
      row({ signedAmount: -1_000, flow: "income" }),
      row({ signedAmount: 200 }), row({ signedAmount: -50 }),
      row({ signedAmount: 700, flow: "transfer" }),
      row({ signedAmount: -700, flow: "transfer" }),
    ]), period([
      row({ signedAmount: -800, flow: "income", date: "2024-02-01" }),
      row({ signedAmount: 200, date: "2024-02-29" }),
    ], { startDate: "2024-02-01", endDate: "2024-02-29" }))!;
    expect(result.income).toEqual({ current: 1000, reference: 800, change: 200, percentageChange: 25 });
    expect(result.spending).toEqual({ current: 150, reference: 200, change: -50, percentageChange: -25 });
    expect(result.net).toEqual({ current: 850, reference: 600, change: 250, percentageChange: 41.67 });
    expect(result.currentCount).toBe(5);
    expect(result.referenceCount).toBe(2);
    expect(result.currentRange).toEqual({ startDate: "2024-03-01", endDate: "2024-03-31" });
    expect(result.referenceRange).toEqual({ startDate: "2024-02-01", endDate: "2024-02-29" });
  });

  it("uses inclusive supplied periods and does not count rows outside either range", () => {
    const rows = [row({ date: "2024-02-29", signedAmount: 3 }), row({ date: "2024-03-01", signedAmount: 5 }),
      row({ date: "2024-03-31", signedAmount: 7 }), row({ date: "2024-04-01", signedAmount: 11 })];
    const result = buildReportComparison(period(rows), period(rows, { startDate: "2024-02-01", endDate: "2024-02-29" }))!;
    expect(result.spending.current).toBe(12);
    expect(result.spending.reference).toBe(3);
    expect(result.currentCount).toBe(2);
    expect(result.referenceCount).toBe(1);
  });

  it("leaves every zero-baseline percentage undefined, even when both periods are zero", () => {
    const empty = buildReportComparison(period(), period())!;
    expect(empty.income.percentageChange).toBeNull();
    expect(empty.spending.percentageChange).toBeNull();
    expect(empty.net.percentageChange).toBeNull();
    expect(empty.categories).toEqual([]);
    expect(empty.currentCount).toBe(0);
    const result = buildReportComparison(period([row()]), period())!;
    expect(result.spending).toEqual({ current: 100, reference: 0, change: 100, percentageChange: null });
    expect(result.categories[0].percentageChange).toBeNull();
  });

  it("keeps percentage direction intuitive for a negative net or refund baseline", () => {
    const result = buildReportComparison(period([row({ signedAmount: -50 })]), period([row({ signedAmount: -100 })]))!;
    expect(result.spending).toEqual({ current: -50, reference: -100, change: 50, percentageChange: 50 });
    expect(result.categories[0].percentageChange).toBe(50);
    const net = buildReportComparison(period([row({ signedAmount: 50 })]), period([row()]))!.net;
    expect(net).toEqual({ current: -50, reference: -100, change: 50, percentageChange: 50 });
  });

  it("unions raw category identities across periods without merging duplicate labels", () => {
    const result = buildReportComparison(period([
      row({ categoryKey: "TRAVEL_OTHER", groupKey: "TRAVEL", signedAmount: 50 }),
      row({ categoryKey: "TRAVEL_OTHER", groupKey: "TRAVEL", signedAmount: -10 }),
      row({ categoryKey: "GENERAL_SERVICES_OTHER", groupKey: "GENERAL_SERVICES", signedAmount: 30 }),
      row({ categoryKey: "INCOME_WAGES", flow: "income", signedAmount: -500 }),
      row({ categoryKey: "TRANSFER_OUT", flow: "transfer" }),
    ]), period([
      row({ categoryKey: "TRAVEL_OTHER", groupKey: "TRAVEL", signedAmount: 60 }),
      row({ categoryKey: "ENTERTAINMENT_MUSIC", groupKey: "ENTERTAINMENT", signedAmount: 15 }),
    ]))!;
    expect(result.categories.map((category) => category.key)).toEqual([
      "GENERAL_SERVICES_OTHER", "TRAVEL_OTHER", "ENTERTAINMENT_MUSIC",
    ]);
    expect(result.categories[0]).toMatchObject({ label: "Other", groupLabel: "General Services", current: 30, reference: 0, change: 30 });
    expect(result.categories[1]).toMatchObject({ label: "Other", groupLabel: "Travel", current: 40, reference: 60, change: -20 });
    expect(result.categories[2]).toMatchObject({ current: 0, reference: 15, change: -15, percentageChange: -100 });
  });

  it("preserves refund-only, zero and unknown category rows and sorts tied changes by raw key", () => {
    const result = buildReportComparison(period([
      row({ categoryKey: "Z", signedAmount: -0.1 }), row({ categoryKey: "Z", signedAmount: -0.2 }),
      row({ categoryKey: "A", signedAmount: 0.3 }),
      row({ categoryKey: "UNCATEGORIZED", groupKey: "UNCATEGORIZED", signedAmount: 0 }),
      row({ categoryKey: "", groupKey: "", signedAmount: 0 }),
    ]), period())!;
    expect(result.spending.current).toBe(0);
    expect(result.categories.map((category) => category.key)).toEqual(["A", "Z", "", "UNCATEGORIZED"]);
    expect(result.categories[1].current).toBe(-0.3);
    expect(result.categories[2].label).toBe("Uncategorized");
    expect(result.categories[3].label).toBe("Uncategorized");
  });

  it("refuses comparisons across declared currencies instead of adding or converting them", () => {
    expect(buildReportComparison(period([row()]), period([row()], { currency: "EUR" }))).toBeNull();
    expect(buildReportComparison(period([row()], { currency: "EUR" }), period([], { currency: "EUR" }))?.currency).toBe("EUR");
  });

  it.each([
    { startDate: "2024-02-30" }, { endDate: "2023-02-29" },
    { startDate: "2024-04-01" }, { startDate: "invalid" },
  ])("rejects invalid or inverted ranges: %j", (overrides) => {
    expect(() => buildReportComparison(period([], overrides), period())).toThrow(RangeError);
    expect(() => buildReportComparison(period(), period([], overrides))).toThrow(RangeError);
  });
});

describe("buildReportSpendingHabits", () => {
  it("uses every elapsed calendar day, including leap day and dates without transactions", () => {
    const habits = buildReportSpendingHabits(period([
      row({ date: "2024-02-28", signedAmount: 60 }),
      row({ date: "2024-02-29", signedAmount: -15 }),
      row({ date: "2024-03-01", signedAmount: 30 }),
    ], { startDate: "2024-02-28", endDate: "2024-03-02" }), "2024-03-10");
    expect(habits).toMatchObject({ throughDate: "2024-03-02", elapsedDays: 4, totalSpending: 75, dailyAverage: 18.75, noSpendDays: 2, transactionCount: 3 });
    expect(habits.weekdays.map((day) => day.label)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(habits.weekdays.map((day) => day.spending)).toEqual([0, 0, 60, -15, 30, 0, 0]);
  });

  it("clips both rows and day counts to viewer today without counting future no-spend days", () => {
    const habits = buildReportSpendingHabits(period([
      row({ date: "2024-03-01", signedAmount: 20 }),
      row({ date: "2024-03-02", signedAmount: 10 }),
      row({ date: "2024-03-03", signedAmount: 999 }),
      row({ date: "2024-02-29", signedAmount: 999 }),
    ]), "2024-03-02");
    expect(habits).toMatchObject({ throughDate: "2024-03-02", elapsedDays: 2, totalSpending: 30, dailyAverage: 15, noSpendDays: 0, transactionCount: 2 });
    expect(habits.range).toEqual({ startDate: "2024-03-01", endDate: "2024-03-31" });
  });

  it("has no denominator or no-spend days in an entirely future range", () => {
    const habits = buildReportSpendingHabits(period([row()]), "2024-02-29");
    expect(habits).toMatchObject({ throughDate: null, elapsedDays: 0, totalSpending: 0, dailyAverage: null, noSpendDays: 0, transactionCount: 0 });
    expect(habits.weekdays.every((day) => day.spending === 0)).toBe(true);
  });

  it("counts an empty elapsed range as zero spending across all calendar days", () => {
    expect(buildReportSpendingHabits(period(), "2024-03-31")).toMatchObject({ elapsedDays: 31, totalSpending: 0, dailyAverage: 0, noSpendDays: 31, transactionCount: 0 });
  });

  it("counts positive expense activity once per day even when refunds cancel its net", () => {
    const habits = buildReportSpendingHabits(period([
      row({ signedAmount: 10 }), row({ signedAmount: 20 }), row({ signedAmount: -30 }),
      row({ date: "2024-03-02", signedAmount: -8 }),
      row({ date: "2024-03-03", signedAmount: 500, flow: "transfer" }),
      row({ date: "2024-03-03", signedAmount: -500, flow: "income" }),
      row({ date: "2024-03-04", signedAmount: 0 }),
    ]), "2024-03-04");
    expect(habits).toMatchObject({ elapsedDays: 4, totalSpending: -8, dailyAverage: -2, noSpendDays: 3 });
    expect(habits.weekdays.find((day) => day.label === "Friday")?.spending).toBe(0);
    expect(habits.weekdays.find((day) => day.label === "Saturday")?.spending).toBe(-8);
  });

  it("includes viewer today and handles a one-day range without timezone conversion", () => {
    const habits = buildReportSpendingHabits(period([
      row({ date: "2024-03-10", signedAmount: 0.1 }),
      row({ date: "2024-03-10", signedAmount: 0.2 }),
    ], { startDate: "2024-03-10", endDate: "2024-03-10", currency: "EUR" }), "2024-03-10");
    expect(habits).toMatchObject({ currency: "EUR", elapsedDays: 1, totalSpending: 0.3, dailyAverage: 0.3, noSpendDays: 0 });
    expect(habits.weekdays.find((day) => day.label === "Sunday")?.spending).toBe(0.3);
  });

  it("rejects invalid dates instead of silently changing the denominator", () => {
    expect(() => buildReportSpendingHabits(period(), "2024-02-30")).toThrow(RangeError);
    expect(() => buildReportSpendingHabits(period([], { endDate: "2024-02-01" }), "2024-03-01")).toThrow(RangeError);
  });
});
