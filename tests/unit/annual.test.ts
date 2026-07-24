import { describe, expect, it } from "vitest";
import { computeYearInMoney, type AnnualTxn } from "@/lib/annual";

const txn = (
  date: string,
  amount: number,
  merchant: string,
  category: string | null = "GENERAL_MERCHANDISE",
): AnnualTxn => ({ date, amount, merchant, category });

describe("computeYearInMoney", () => {
  const year = [
    txn("2026-01-10", 1200, "Rent Co", "RENT_AND_UTILITIES"),
    txn("2026-01-15", -3000, "Acme Payroll", "INCOME"),
    txn("2026-03-05", 480.5, "Grocer", "FOOD_AND_DRINK"),
    txn("2026-03-20", 899.99, "Airline", "TRAVEL"),
    txn("2026-03-25", -3000, "Acme Payroll", "INCOME"),
    txn("2026-07-04", 45.25, "Grocer", "FOOD_AND_DRINK"),
  ];

  it("computes totals, savings rate, and the tracked-transaction count", () => {
    const result = computeYearInMoney(year, "2026");
    expect(result).not.toBeNull();
    expect(result!.totalSpend).toBe(1200 + 480.5 + 899.99 + 45.25);
    expect(result!.totalIncome).toBe(6000);
    // (6000 − 2625.74) / 6000 = 56.2% → rounded to 56
    expect(result!.savingsRate).toBe(56);
    expect(result!.transactionCount).toBe(6);
  });

  it("excludes transfers and loan payments from every figure", () => {
    const result = computeYearInMoney(
      [
        ...year,
        txn("2026-02-01", 5000, "CC Payment", "LOAN_PAYMENTS"),
        txn("2026-02-02", -5000, "Transfer In", "TRANSFER_IN"),
      ],
      "2026",
    );
    expect(result!.totalSpend).toBe(1200 + 480.5 + 899.99 + 45.25);
    expect(result!.totalIncome).toBe(6000);
    expect(result!.transactionCount).toBe(6);
    expect(result!.largestPurchase!.merchant).toBe("Rent Co");
  });

  it("only counts the requested calendar year", () => {
    const result = computeYearInMoney(
      [...year, txn("2025-12-31", 999, "Last Year"), txn("2027-01-01", 999, "Next Year")],
      "2026",
    );
    expect(result!.totalSpend).toBe(1200 + 480.5 + 899.99 + 45.25);
  });

  it("ranks top merchants and categories, capped at five", () => {
    const many = [
      ...year,
      txn("2026-04-01", 10, "A", "A_CAT"),
      txn("2026-04-02", 20, "B", "B_CAT"),
      txn("2026-04-03", 30, "C", "C_CAT"),
      txn("2026-04-04", 40, "D", "D_CAT"),
    ];
    const result = computeYearInMoney(many, "2026")!;
    expect(result.topMerchants).toHaveLength(5);
    expect(result.topMerchants[0]).toEqual({ merchant: "Rent Co", amount: 1200 });
    // Grocer aggregates across both charges
    expect(result.topMerchants[2]).toEqual({ merchant: "Grocer", amount: 525.75 });
    expect(result.topCategories).toHaveLength(5);
    expect(result.topCategories[0]).toEqual({
      category: "RENT_AND_UTILITIES",
      amount: 1200,
    });
  });

  it("finds the biggest month, quietest non-zero month, and largest purchase", () => {
    const result = computeYearInMoney(year, "2026")!;
    expect(result.biggestMonth).toEqual({ month: "2026-03", spend: 1380.49 });
    expect(result.quietestMonth).toEqual({ month: "2026-07", spend: 45.25 });
    expect(result.largestPurchase).toEqual({
      merchant: "Rent Co",
      amount: 1200,
      date: "2026-01-10",
    });
  });

  it("always returns a 12-entry monthly series with zeros for quiet months", () => {
    const result = computeYearInMoney(year, "2026")!;
    expect(result.monthlySpendSeries).toHaveLength(12);
    expect(result.monthlySpendSeries[0]).toBe(1200); // January
    expect(result.monthlySpendSeries[1]).toBe(0); // February
    expect(result.monthlySpendSeries[2]).toBe(1380.49); // March
  });

  it("returns null when the year has no meaningful rows", () => {
    expect(computeYearInMoney([], "2026")).toBeNull();
    expect(computeYearInMoney(year, "2019")).toBeNull();
    expect(
      computeYearInMoney(
        [txn("2026-05-01", 500, "Transfer", "TRANSFER_OUT")],
        "2026",
      ),
    ).toBeNull();
  });

  it("floors the savings rate at zero and survives a no-income year", () => {
    const spendOnly = [txn("2026-06-01", 100, "Shop")];
    expect(computeYearInMoney(spendOnly, "2026")!.savingsRate).toBe(0);
    expect(computeYearInMoney(spendOnly, "2026")!.biggestMonth).toEqual({
      month: "2026-06",
      spend: 100,
    });
    const overspent = [...spendOnly, txn("2026-06-02", -50, "Gig", "INCOME")];
    expect(computeYearInMoney(overspent, "2026")!.savingsRate).toBe(0);
  });

  it("handles an income-only year without spend-derived fields", () => {
    const incomeOnly = [txn("2026-02-01", -2000, "Payroll", "INCOME")];
    const result = computeYearInMoney(incomeOnly, "2026")!;
    expect(result.totalSpend).toBe(0);
    expect(result.biggestMonth).toBeNull();
    expect(result.quietestMonth).toBeNull();
    expect(result.largestPurchase).toBeNull();
  });
});
