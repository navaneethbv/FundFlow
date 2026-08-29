import { describe, expect, it } from "vitest";
import {
  computeYearInMoney,
  computeYearInMoneyFromProjection,
  type AnnualTxn,
} from "@/lib/annual";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

const txn = (
  date: string,
  amount: number,
  merchant: string,
  category: string | null = "GENERAL_MERCHANDISE",
): AnnualTxn => ({ date, amount, merchant, category });

function projected(
  partial: Partial<CanonicalFinanceTransaction> = {},
): CanonicalFinanceTransaction {
  return {
    id: "txn-1",
    sourceTransactionId: "txn-1",
    date: "2026-03-05",
    signedAmount: 100,
    flow: "expense",
    merchant: "Shop",
    groupKey: "GENERAL_MERCHANDISE",
    categoryKey: "GENERAL_MERCHANDISE",
    accountId: "acct-1",
    manualAccountId: null,
    pending: false,
    source: "plaid",
    ...partial,
  } as CanonicalFinanceTransaction;
}

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
    // (6000 − 2625.74) / 6000 = 56.24%
    expect(result!.savingsRate).toBe(56.24);
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

  it("handles signed savings rate and survives a no-income year", () => {
    const spendOnly = [txn("2026-06-01", 100, "Shop")];
    expect(computeYearInMoney(spendOnly, "2026")!.savingsRate).toBeNull();
    expect(computeYearInMoney(spendOnly, "2026")!.biggestMonth).toEqual({
      month: "2026-06",
      spend: 100,
    });
    const overspent = [...spendOnly, txn("2026-06-02", -50, "Gig", "INCOME")];
    expect(computeYearInMoney(overspent, "2026")!.savingsRate).toBe(-100);
  });

  it("handles an income-only year without spend-derived fields", () => {
    const incomeOnly = [txn("2026-02-01", -2000, "Payroll", "INCOME")];
    const result = computeYearInMoney(incomeOnly, "2026")!;
    expect(result.totalSpend).toBe(0);
    expect(result.biggestMonth).toBeNull();
    expect(result.quietestMonth).toBeNull();
    expect(result.largestPurchase).toBeNull();
  });

  it("handles null category and zero amount transactions", () => {
    const nullCat = [
      txn("2026-05-01", 50, "Vendor", null),
      txn("2026-05-02", 0, "Zero Vendor", null),
    ];
    const result = computeYearInMoney(nullCat, "2026")!;
    expect(result.topCategories[0]!.category).toBe("UNCATEGORIZED");
    expect(result.totalSpend).toBe(50);
  });
});

describe("computeYearInMoneyFromProjection", () => {
  it("aggregates the full below-ceiling set without a 1,000-row cap", () => {
    const rows: CanonicalFinanceTransaction[] = [];
    for (let index = 0; index < 16_497; index += 1) {
      const month = String((index % 12) + 1).padStart(2, "0");
      rows.push(
        projected({
          id: `txn-${index}`,
          sourceTransactionId: `txn-${index}`,
          date: `2026-${month}-${String((index % 28) + 1).padStart(2, "0")}`,
          signedAmount: index % 2 === 0 ? 50 : -1000,
          flow: index % 2 === 0 ? "expense" : "income",
          merchant: index % 2 === 0 ? "Shop" : "Payroll",
          groupKey: index % 2 === 0 ? "GENERAL_MERCHANDISE" : "INCOME",
        }),
      );
    }
    const recap = computeYearInMoneyFromProjection(rows, "2026")!;
    const spendCount = 8_249;
    const incomeCount = 8_248;
    expect(recap.transactionCount).toBe(16_497);
    expect(recap.totalSpend).toBe(spendCount * 50);
    expect(recap.totalIncome).toBe(incomeCount * 1000);
    expect(recap.largestPurchase!.amount).toBe(50);
  });

  it("drops transfers and linked-refund halves by flow", () => {
    const rows = [
      projected({ signedAmount: 5000, flow: "transfer", merchant: "CC Payment" }),
      projected({ signedAmount: -5000, flow: "transfer", merchant: "Refund" }),
      projected({ signedAmount: 100, flow: "expense", merchant: "Shop" }),
    ];
    const recap = computeYearInMoneyFromProjection(rows, "2026")!;
    expect(recap.transactionCount).toBe(1);
    expect(recap.totalSpend).toBe(100);
    expect(recap.totalIncome).toBe(0);
  });

  it("counts split parts as rows and totals them once", () => {
    const rows = [
      projected({ id: "parent::0", signedAmount: 40, categoryKey: "Groceries" }),
      projected({ id: "parent::1", signedAmount: 60, categoryKey: "Dining" }),
    ];
    const recap = computeYearInMoneyFromProjection(rows, "2026")!;
    expect(recap.transactionCount).toBe(2);
    expect(recap.totalSpend).toBe(100);
    expect(recap.topCategories[0]!.amount).toBe(100);
  });

  it("only counts the requested calendar year", () => {
    const rows = [
      projected({ date: "2025-12-31", signedAmount: 999, flow: "expense" }),
      projected({ date: "2026-01-01", signedAmount: 100, flow: "expense" }),
      projected({ date: "2027-01-01", signedAmount: 999, flow: "expense" }),
    ];
    const recap = computeYearInMoneyFromProjection(rows, "2026")!;
    expect(recap.transactionCount).toBe(1);
    expect(recap.totalSpend).toBe(100);
  });

  it("returns null when no meaningful rows remain", () => {
    expect(
      computeYearInMoneyFromProjection(
        [projected({ flow: "transfer" })],
        "2026",
      ),
    ).toBeNull();
    expect(computeYearInMoneyFromProjection([], "2026")).toBeNull();
  });
});
