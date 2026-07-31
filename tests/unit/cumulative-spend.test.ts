import { describe, it, expect } from "vitest";
import { computeCumulativeSpendByDay } from "@/lib/dashboard";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

/**
 * The spending-vs-last-month widget. Two things here are easy to get subtly
 * wrong and impossible to see on the chart:
 *
 *   * A future day must be `null`, not `0`. Zero draws a line along the floor
 *     that reads as "spent nothing today" instead of "the day has not happened".
 *   * A previous month with fewer days must run out, not flatten. February
 *     compared against a 31-day month has no day 30, and inventing one would
 *     claim a spending pause that never occurred.
 */

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
    categoryKey: "FOOD_AND_DRINK_GROCERIES",
    accountId: "acct-1",
    manualAccountId: null,
    pending: false,
    source: "plaid",
    ...partial,
  };
}

function dayRow(
  rows: ReturnType<typeof computeCumulativeSpendByDay>,
  day: number,
) {
  return rows.find((row) => row.day === day)!;
}

describe("computeCumulativeSpendByDay shape", () => {
  it("returns one row per day of the month", () => {
    const rows = computeCumulativeSpendByDay([], "2026-07", "2026-07-31");
    expect(rows).toHaveLength(31);
    expect(rows[0]!.day).toBe(1);
    expect(rows.at(-1)!.day).toBe(31);
  });

  it("handles a 30-day month and February", () => {
    expect(computeCumulativeSpendByDay([], "2026-04", "2026-04-30")).toHaveLength(30);
    expect(computeCumulativeSpendByDay([], "2026-02", "2026-02-28")).toHaveLength(28);
  });

  it("handles a leap February", () => {
    expect(computeCumulativeSpendByDay([], "2028-02", "2028-02-29")).toHaveLength(29);
  });
});

describe("computeCumulativeSpendByDay accumulation", () => {
  const rows = [
    txn("2026-07-02", 100),
    txn("2026-07-02", 50),
    txn("2026-07-10", 25),
    // Previous month, for the comparison series.
    txn("2026-06-05", 400),
    txn("2026-06-20", 100),
  ];

  it("accumulates this month's spend day by day", () => {
    const result = computeCumulativeSpendByDay(rows, "2026-07", "2026-07-31");
    expect(dayRow(result, 1).thisMonth).toBe(0);
    expect(dayRow(result, 2).thisMonth).toBe(150);
    expect(dayRow(result, 9).thisMonth).toBe(150);
    expect(dayRow(result, 10).thisMonth).toBe(175);
    expect(dayRow(result, 31).thisMonth).toBe(175);
  });

  it("accumulates the previous month alongside it", () => {
    const result = computeCumulativeSpendByDay(rows, "2026-07", "2026-07-31");
    expect(dayRow(result, 4).lastMonth).toBe(0);
    expect(dayRow(result, 5).lastMonth).toBe(400);
    expect(dayRow(result, 20).lastMonth).toBe(500);
    expect(dayRow(result, 30).lastMonth).toBe(500);
  });

  it("crosses a year boundary for the previous month", () => {
    const result = computeCumulativeSpendByDay(
      [txn("2025-12-31", 90)],
      "2026-01",
      "2026-01-31",
    );
    expect(dayRow(result, 31).lastMonth).toBe(90);
  });

  it("ignores months either side of the two it compares", () => {
    const result = computeCumulativeSpendByDay(
      [txn("2026-05-01", 999), txn("2026-08-01", 999)],
      "2026-07",
      "2026-07-31",
    );
    expect(dayRow(result, 31).thisMonth).toBe(0);
    expect(dayRow(result, 30).lastMonth).toBe(0);
  });
});

describe("computeCumulativeSpendByDay exclusions", () => {
  it("counts spending only, never income", () => {
    const result = computeCumulativeSpendByDay(
      [txn("2026-07-03", -5000), txn("2026-07-03", 80)],
      "2026-07",
      "2026-07-31",
    );
    expect(dayRow(result, 3).thisMonth).toBe(80);
  });

  it("ignores transfers, so a refund pair and a card payment cannot distort it", () => {
    const result = computeCumulativeSpendByDay(
      [
        txn("2026-07-03", 200),
        txn("2026-07-04", 200, { flow: "transfer" }),
        txn("2026-07-04", -200, { flow: "transfer" }),
        txn("2026-07-05", 900, { flow: "transfer", groupKey: "LOAN_PAYMENTS" }),
      ],
      "2026-07",
      "2026-07-31",
    );
    expect(dayRow(result, 31).thisMonth).toBe(200);
  });

  it("includes pending rows, matching every other total in the app", () => {
    const result = computeCumulativeSpendByDay(
      [txn("2026-07-03", 60, { pending: true })],
      "2026-07",
      "2026-07-31",
    );
    expect(dayRow(result, 3).thisMonth).toBe(60);
  });

  it("rounds to cents rather than accumulating float drift", () => {
    const result = computeCumulativeSpendByDay(
      [txn("2026-07-01", 0.1), txn("2026-07-01", 0.2)],
      "2026-07",
      "2026-07-31",
    );
    expect(dayRow(result, 1).thisMonth).toBe(0.3);
  });
});

describe("computeCumulativeSpendByDay future days", () => {
  const rows = [txn("2026-07-02", 100)];

  it("nulls every day after today so the line stops at the present", () => {
    const result = computeCumulativeSpendByDay(rows, "2026-07", "2026-07-15");
    expect(dayRow(result, 15).thisMonth).toBe(100);
    expect(dayRow(result, 16).thisMonth).toBeNull();
    expect(dayRow(result, 31).thisMonth).toBeNull();
  });

  it("fills the whole month once it is in the past", () => {
    const result = computeCumulativeSpendByDay(rows, "2026-07", "2026-09-01");
    expect(dayRow(result, 31).thisMonth).toBe(100);
  });

  it("nulls the whole month when it has not started", () => {
    const result = computeCumulativeSpendByDay(rows, "2026-07", "2026-06-30");
    expect(result.every((row) => row.thisMonth === null)).toBe(true);
  });

  it("compares dates as strings, so no timezone can shift the boundary", () => {
    // A Date-based implementation run in a negative-offset zone would treat
    // this as the 14th and hide a day of real spending.
    const result = computeCumulativeSpendByDay(
      [txn("2026-07-15", 42)],
      "2026-07",
      "2026-07-15",
    );
    expect(dayRow(result, 15).thisMonth).toBe(42);
  });

  it("leaves the previous month complete regardless of today", () => {
    const result = computeCumulativeSpendByDay(
      [txn("2026-06-25", 300)],
      "2026-07",
      "2026-07-02",
    );
    expect(dayRow(result, 30).lastMonth).toBe(300);
  });
});

describe("computeCumulativeSpendByDay short previous months", () => {
  it("stops the previous series after that month's final day", () => {
    // July has 31 days, June has 30: day 31 has no June counterpart.
    const result = computeCumulativeSpendByDay([], "2026-07", "2026-07-31");
    expect(dayRow(result, 30).lastMonth).toBe(0);
    expect(dayRow(result, 31).lastMonth).toBeNull();
  });

  it("stops after a non-leap February", () => {
    const result = computeCumulativeSpendByDay([], "2026-03", "2026-03-31");
    expect(dayRow(result, 28).lastMonth).toBe(0);
    expect(dayRow(result, 29).lastMonth).toBeNull();
    expect(dayRow(result, 31).lastMonth).toBeNull();
  });

  it("keeps day 29 in a leap February", () => {
    const result = computeCumulativeSpendByDay([], "2028-03", "2028-03-31");
    expect(dayRow(result, 29).lastMonth).toBe(0);
    expect(dayRow(result, 30).lastMonth).toBeNull();
  });

  it("never nulls the previous series when it is the longer month", () => {
    // June (30) against July (31): every June day has a July counterpart.
    const result = computeCumulativeSpendByDay([], "2026-06", "2026-06-30");
    expect(result.every((row) => row.lastMonth !== null)).toBe(true);
  });
});
