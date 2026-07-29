import { describe, expect, it } from "vitest";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
import {
  breakdownBy,
  cashFlowPeriodKey,
  computePeriodCashFlow,
  filterCashFlowPeriod,
  partitionCashFlowByCurrency,
} from "@/lib/cash-flow";

function transaction(
  input: Partial<CanonicalFinanceTransaction> &
    Pick<
      CanonicalFinanceTransaction,
      "id" | "date" | "signedAmount" | "flow"
    >,
): CanonicalFinanceTransaction {
  return {
    sourceTransactionId: input.id,
    merchant: "Merchant",
    groupKey: "FOOD_AND_DRINK",
    categoryKey: "GROCERIES",
    accountId: "account-usd",
    manualAccountId: null,
    pending: false,
    source: "plaid",
    ...input,
  };
}

const PERIOD_ROWS: CanonicalFinanceTransaction[] = [
  transaction({
    id: "march-expense",
    date: "2024-03-01",
    signedAmount: 50,
    flow: "expense",
  }),
  transaction({
    id: "leap-paycheck",
    date: "2024-02-29",
    signedAmount: -1000,
    flow: "income",
  }),
  transaction({
    id: "feb-rent",
    date: "2024-02-01",
    signedAmount: 1000,
    flow: "expense",
  }),
  transaction({
    id: "feb-groceries",
    date: "2024-02-15",
    signedAmount: 200,
    flow: "expense",
  }),
  transaction({
    id: "feb-transfer",
    date: "2024-02-20",
    signedAmount: -500,
    flow: "transfer",
  }),
];

describe("cashFlowPeriodKey", () => {
  it("derives stable month, quarter, and year keys from date strings", () => {
    expect(cashFlowPeriodKey("2024-02-29", "monthly")).toBe("2024-02");
    expect(cashFlowPeriodKey("2024-02-29", "quarterly")).toBe("2024-Q1");
    expect(cashFlowPeriodKey("2024-02-29", "yearly")).toBe("2024");
  });
});

describe("computePeriodCashFlow", () => {
  it("buckets months in ascending order and excludes transfers", () => {
    expect(computePeriodCashFlow(PERIOD_ROWS, "monthly")).toEqual([
      {
        key: "2024-02",
        label: "Feb 2024",
        income: 1000,
        expenses: 1200,
        savings: -200,
        savingsRate: -20,
      },
      {
        key: "2024-03",
        label: "Mar 2024",
        income: 0,
        expenses: 50,
        savings: -50,
        savingsRate: 0,
      },
    ]);
  });

  it("buckets quarters with a zero-income guard", () => {
    expect(computePeriodCashFlow(PERIOD_ROWS, "quarterly")).toEqual([
      {
        key: "2024-Q1",
        label: "Q1 2024",
        income: 1000,
        expenses: 1250,
        savings: -250,
        savingsRate: -25,
      },
    ]);
  });

  it("buckets years without losing leap-day transactions", () => {
    expect(computePeriodCashFlow(PERIOD_ROWS, "yearly")).toEqual([
      {
        key: "2024",
        label: "2024",
        income: 1000,
        expenses: 1250,
        savings: -250,
        savingsRate: -25,
      },
    ]);
  });
});

describe("breakdownBy", () => {
  const rows = [
    transaction({
      id: "grocer-1",
      date: "2026-07-01",
      signedAmount: 50,
      flow: "expense",
      merchant: "Grocer",
      groupKey: "FOOD_AND_DRINK",
      categoryKey: "GROCERIES",
    }),
    transaction({
      id: "grocer-2",
      date: "2026-07-02",
      signedAmount: 25,
      flow: "expense",
      merchant: "Grocer",
      groupKey: "FOOD_AND_DRINK",
      categoryKey: "GROCERIES",
    }),
    transaction({
      id: "unknown",
      date: "2026-07-03",
      signedAmount: 25,
      flow: "expense",
      merchant: "",
      groupKey: "",
      categoryKey: "",
    }),
    transaction({
      id: "paycheck",
      date: "2026-07-04",
      signedAmount: -1000,
      flow: "income",
      merchant: "Employer",
      groupKey: "INCOME",
      categoryKey: "INCOME_WAGES",
    }),
    transaction({
      id: "transfer",
      date: "2026-07-05",
      signedAmount: 500,
      flow: "transfer",
      merchant: "Transfer",
    }),
  ];

  it("groups expenses by merchant and normalizes blank labels", () => {
    expect(breakdownBy(rows, "merchant", "expense")).toEqual([
      { label: "Grocer", amount: 75, pct: 75 },
      { label: "Unknown", amount: 25, pct: 25 },
    ]);
  });

  it("uses canonical category and group values", () => {
    expect(breakdownBy(rows, "category", "expense")).toEqual([
      { label: "GROCERIES", amount: 75, pct: 75 },
      { label: "Unknown", amount: 25, pct: 25 },
    ]);
    expect(breakdownBy(rows, "group", "income")).toEqual([
      { label: "INCOME", amount: 1000, pct: 100 },
    ]);
  });

  it("reconciles rounded percentages to exactly 100", () => {
    const equalRows = ["Alpha", "Bravo", "Charlie"].map((merchant, index) =>
      transaction({
        id: `equal-${index}`,
        date: "2026-07-01",
        signedAmount: 1,
        flow: "expense",
        merchant,
      }),
    );
    const breakdown = breakdownBy(equalRows, "merchant", "expense");

    expect(breakdown).toEqual([
      { label: "Alpha", amount: 1, pct: 33.33 },
      { label: "Bravo", amount: 1, pct: 33.33 },
      { label: "Charlie", amount: 1, pct: 33.34 },
    ]);
    expect(breakdown.reduce((sum, row) => sum + row.pct, 0)).toBe(100);
  });

  it("returns no rows when the requested direction has no total", () => {
    expect(breakdownBy(rows, "merchant", "income")).toEqual([
      { label: "Employer", amount: 1000, pct: 100 },
    ]);
    expect(
      breakdownBy(
        rows.filter((row) => row.flow !== "income"),
        "merchant",
        "income",
      ),
    ).toEqual([]);
  });
});

describe("cash flow selection and currencies", () => {
  it("filters rows to the selected period key", () => {
    expect(
      filterCashFlowPeriod(PERIOD_ROWS, "monthly", "2024-03").map(
        (row) => row.id,
      ),
    ).toEqual(["march-expense"]);
  });

  it("partitions rows by account currency without combining unknowns", () => {
    const rows = [
      transaction({
        id: "usd",
        date: "2026-07-01",
        signedAmount: 10,
        flow: "expense",
        accountId: "account-usd",
      }),
      transaction({
        id: "cad",
        date: "2026-07-01",
        signedAmount: 20,
        flow: "expense",
        accountId: "account-cad",
      }),
      transaction({
        id: "unknown",
        date: "2026-07-01",
        signedAmount: 30,
        flow: "expense",
        accountId: "account-missing",
      }),
    ];

    const groups = partitionCashFlowByCurrency(
      rows,
      new Map([
        ["account-usd", "usd"],
        ["account-cad", "CAD"],
      ]),
    );

    expect([...groups.keys()]).toEqual(["CAD", "Unknown currency", "USD"]);
    expect(groups.get("CAD")?.map((row) => row.id)).toEqual(["cad"]);
    expect(groups.get("USD")?.map((row) => row.id)).toEqual(["usd"]);
    expect(groups.get("Unknown currency")?.map((row) => row.id)).toEqual([
      "unknown",
    ]);
  });
});
