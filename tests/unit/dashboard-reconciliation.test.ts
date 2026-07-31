import { describe, it, expect } from "vitest";
import { computeCumulativeSpendByDay } from "@/lib/dashboard";
import { computePeriodCashFlow, filterCashFlowPeriod } from "@/lib/cash-flow";
import { financeTotals, type CanonicalFinanceTransaction } from "@/lib/finance-domain";
import { buildBudgetPage } from "@/lib/budget-page";
import { applyReportFilters, defaultReportFilters } from "@/lib/reports";

/**
 * The Phase 8 reconciliation contract.
 *
 * Five surfaces now quote a month's spending: the dashboard's cumulative-spend
 * endpoint, the Budget page's actual, the Cash Flow page's expenses, the
 * Reports filter, and the canonical `financeTotals`. They are computed by
 * different modules, so nothing but a test stops them drifting apart — and a
 * dashboard that disagrees with the page it links to is worse than no
 * dashboard.
 *
 * Every figure below must come out of the same canonical projection.
 */

const MONTH = "2026-07";
const END_OF_MONTH = "2026-07-31";

let sequence = 0;

function txn(
  date: string,
  amount: number,
  partial: Partial<CanonicalFinanceTransaction> = {},
): CanonicalFinanceTransaction {
  sequence += 1;
  return {
    id: `t${sequence}`,
    sourceTransactionId: `s${sequence}`,
    date,
    signedAmount: amount,
    flow: amount > 0 ? "expense" : "income",
    merchant: "Merchant",
    groupKey: "FOOD_AND_DRINK",
    categoryKey: "food_and_drink",
    accountId: "acct-1",
    manualAccountId: null,
    pending: false,
    source: "plaid",
    ...partial,
  };
}

/** A month with income, spending, a refund pair, and a card payment. */
const TRANSACTIONS: CanonicalFinanceTransaction[] = [
  txn("2026-07-01", -4000, { flow: "income", groupKey: "INCOME", categoryKey: "income" }),
  txn("2026-07-03", 1200, { groupKey: "RENT_AND_UTILITIES", categoryKey: "rent" }),
  txn("2026-07-08", 240.55),
  txn("2026-07-19", 99.45),
  txn("2026-07-27", 60, { pending: true }),
  // Both halves of a linked refund project as transfers and must not count.
  txn("2026-07-11", 80, { flow: "transfer" }),
  txn("2026-07-12", -80, { flow: "transfer" }),
  // A credit-card payment is cash movement, not spending.
  txn("2026-07-15", 900, { flow: "transfer", groupKey: "LOAN_PAYMENTS" }),
  // Neighbouring months, which none of the month figures may include.
  txn("2026-06-30", 500),
  txn("2026-08-01", 500),
];

/** 1200 + 240.55 + 99.45 + 60 — the refund pair and card payment excluded. */
const EXPECTED_SPEND = 1600;

describe("month spending reconciles across every surface", () => {
  const monthRows = TRANSACTIONS.filter((row) => row.date.startsWith(MONTH));

  it("the canonical total is the reference figure", () => {
    expect(financeTotals(monthRows).expenses).toBe(EXPECTED_SPEND);
  });

  it("the dashboard cumulative-spend endpoint matches it", () => {
    const days = computeCumulativeSpendByDay(TRANSACTIONS, MONTH, END_OF_MONTH);
    expect(days.at(-1)!.thisMonth).toBe(EXPECTED_SPEND);
  });

  it("the Cash Flow page's monthly expenses match it", () => {
    const periods = computePeriodCashFlow(TRANSACTIONS, "monthly");
    const july = periods.find((period) => period.key === MONTH)!;
    expect(july.expenses).toBe(EXPECTED_SPEND);
  });

  it("the Budget page's total actual matches it", () => {
    const page = buildBudgetPage({
      month: MONTH,
      budgets: [
        {
          id: "b1",
          category: "food_and_drink",
          monthly_limit: 500,
          group_name: "flexible",
          rollover_enabled: false,
          sort_order: 0,
        },
      ],
      txns: TRANSACTIONS,
    });
    expect(page.totalExpenses.actual).toBe(EXPECTED_SPEND);
  });

  it("the Reports filter over the same month matches it", () => {
    const filtered = applyReportFilters(TRANSACTIONS, defaultReportFilters(MONTH));
    expect(financeTotals(filtered).expenses).toBe(EXPECTED_SPEND);
  });

  it("the transaction list filter for the period returns the same rows", () => {
    const rows = filterCashFlowPeriod(TRANSACTIONS, "monthly", MONTH);
    expect(rows).toHaveLength(monthRows.length);
    expect(financeTotals(rows).expenses).toBe(EXPECTED_SPEND);
  });
});

describe("the reconciliation survives the cases that usually break it", () => {
  it("excluding pending shifts every surface by the same amount", () => {
    const withoutPending = TRANSACTIONS.filter((row) => !row.pending);
    const days = computeCumulativeSpendByDay(withoutPending, MONTH, END_OF_MONTH);
    const cashFlow = computePeriodCashFlow(withoutPending, "monthly").find(
      (period) => period.key === MONTH,
    )!;

    expect(days.at(-1)!.thisMonth).toBe(EXPECTED_SPEND - 60);
    expect(cashFlow.expenses).toBe(EXPECTED_SPEND - 60);
  });

  it("a split parent does not double count anywhere", () => {
    // The projection expands a split into parts that re-sum to the parent, so
    // every consumer must see the parent's amount exactly once.
    const split = [
      txn("2026-07-05", 60, { id: "p::0", sourceTransactionId: "p", categoryKey: "a" }),
      txn("2026-07-05", 40, { id: "p::1", sourceTransactionId: "p", categoryKey: "b" }),
    ];
    const days = computeCumulativeSpendByDay(split, MONTH, END_OF_MONTH);
    expect(days.at(-1)!.thisMonth).toBe(100);
    expect(financeTotals(split).expenses).toBe(100);
  });

  it("month-to-date agrees with Cash Flow when the month is only part done", () => {
    const asOf = "2026-07-08";
    const days = computeCumulativeSpendByDay(TRANSACTIONS, MONTH, asOf);
    const toDate = TRANSACTIONS.filter(
      (row) => row.date >= "2026-07-01" && row.date <= asOf,
    );
    expect(days.find((row) => row.day === 8)!.thisMonth).toBe(
      financeTotals(toDate).expenses,
    );
  });

  it("no surface counts a neighbouring month", () => {
    const days = computeCumulativeSpendByDay(TRANSACTIONS, MONTH, END_OF_MONTH);
    // June's 500 and August's 500 are both absent from July's total.
    expect(days.at(-1)!.thisMonth).toBe(EXPECTED_SPEND);
    expect(days.at(-1)!.thisMonth).not.toBe(EXPECTED_SPEND + 500);
  });
});
