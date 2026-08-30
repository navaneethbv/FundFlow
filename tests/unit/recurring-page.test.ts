import { describe, expect, it } from "vitest";
import {
  countUnreviewedStreams,
  expandStreamsForMonth,
  occurrenceDatesInWindow,
  type RecurringStreamInput,
} from "@/lib/recurring-page";

describe("occurrenceDatesInWindow", () => {
  it("returns every weekly occurrence anchored ahead of the window", () => {
    const dates = occurrenceDatesInWindow(
      "2026-08-05",
      { unit: "days", amount: 7 },
      "2026-07-01",
      "2026-08-01",
    );
    expect(dates).toEqual(["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"]);
  });

  it("returns one monthly occurrence for the anchor's own month", () => {
    const dates = occurrenceDatesInWindow(
      "2026-07-15",
      { unit: "months", amount: 1 },
      "2026-07-01",
      "2026-08-01",
    );
    expect(dates).toEqual(["2026-07-15"]);
  });

  it("returns no annual occurrence for a month that isn't the anniversary month", () => {
    const dates = occurrenceDatesInWindow(
      "2026-03-01",
      { unit: "months", amount: 12 },
      "2026-07-01",
      "2026-08-01",
    );
    expect(dates).toEqual([]);
  });

  it("steps a semi-monthly cadence every 15 days across a 31-day month", () => {
    const dates = occurrenceDatesInWindow(
      "2026-07-01",
      { unit: "days", amount: 15 },
      "2026-07-01",
      "2026-08-01",
    );
    // A fixed 15-day step from day 1 lands on 1, 16, 31 within a 31-day
    // month -- three occurrences, not the "twice a month" a real
    // day-of-month-anchored semi-monthly schedule would give. This is the
    // documented approximation (see FREQUENCY_LABELS below): Plaid doesn't
    // give us a day-of-month anchor beyond first_date/last_date, so this
    // step size is an approximation, not an exact twice-monthly match.
    expect(dates).toEqual(["2026-07-01", "2026-07-16", "2026-07-31"]);
  });

  it("carries a leap-day monthly anchor across February without throwing", () => {
    const dates = occurrenceDatesInWindow(
      "2028-01-29",
      { unit: "months", amount: 1 },
      "2028-02-01",
      "2028-03-01",
    );
    // JS month-stepping on a day-of-month past the target month's length
    // rolls into the following month (2028 is a leap year: Jan 29 + 1 month
    // lands on Feb 29, which does exist). This is a real date, not a bug.
    expect(dates).toEqual(["2028-02-29"]);
  });
});

describe("countUnreviewedStreams", () => {
  it("counts only active, MATURE, non-dismissed, unreviewed streams", () => {
    const count = countUnreviewedStreams([
      { isActive: true, status: "MATURE", dismissedAt: null, reviewedAt: null },
      { isActive: true, status: "MATURE", dismissedAt: null, reviewedAt: "2026-07-01T00:00:00Z" },
      { isActive: true, status: "MATURE", dismissedAt: "2026-07-01T00:00:00Z", reviewedAt: null },
      { isActive: true, status: "EARLY_DETECTION", dismissedAt: null, reviewedAt: null },
      { isActive: false, status: "MATURE", dismissedAt: null, reviewedAt: null },
    ]);
    expect(count).toBe(1);
  });
});

function stream(overrides: Partial<RecurringStreamInput> = {}): RecurringStreamInput {
  return {
    id: "stream-1",
    streamType: "outflow",
    merchantName: "Netflix",
    description: null,
    averageAmount: 15.49,
    lastAmount: 15.49,
    userAmount: null,
    frequency: "MONTHLY",
    status: "MATURE",
    isActive: true,
    accountName: "Checking",
    firstDate: "2026-01-15",
    lastDate: "2026-06-15",
    predictedNextDate: "2026-07-15",
    reviewedAt: "2026-01-16T00:00:00Z",
    dismissedAt: null,
    matchedTransactions: [],
    category: null,
    source: "plaid",
    detectionEvidence: null,
    ...overrides,
  };
}

describe("inferred stream projection", () => {
  it("expands a quarterly cadence three months apart", () => {
    const dates = occurrenceDatesInWindow(
      "2026-06-15",
      { unit: "months", amount: 3 },
      "2026-09-01",
      "2026-10-01",
    );
    expect(dates).toEqual(["2026-09-15"]);
  });

  it("labels an inferred quarterly occurrence with its source and evidence count", () => {
    const result = expandStreamsForMonth(
      [
        stream({
          source: "inferred",
          frequency: "QUARTERLY",
          predictedNextDate: "2026-09-15",
          detectionEvidence: {
            occurrenceCount: 3,
            amountPattern: "fixed",
            maximumCadenceDeviationDays: 1,
            matchedSignifiers: [],
          },
        }),
      ],
      [],
      "2026-09",
      "2026-09-10",
    );

    expect(result.occurrences[0]).toMatchObject({
      source: "inferred",
      evidenceCount: 3,
      frequency: "Every quarter",
    });
  });

  it("leaves a Plaid occurrence without an evidence count", () => {
    const result = expandStreamsForMonth(
      [stream({ predictedNextDate: "2026-07-15" })],
      [],
      "2026-07",
      "2026-07-10",
    );

    expect(result.occurrences[0]).toMatchObject({ source: "plaid", evidenceCount: null });
  });

  it("counts an inferred mature stream as unreviewed", () => {
    expect(
      countUnreviewedStreams([
        {
          isActive: true,
          status: "MATURE",
          dismissedAt: null,
          reviewedAt: null,
        },
      ]),
    ).toBe(1);
  });
});

describe("expandStreamsForMonth", () => {
  it("marks an occurrence complete when a matched transaction lands near the due date", () => {
    const month = expandStreamsForMonth(
      [stream({ matchedTransactions: [{ id: "txn-1", date: "2026-07-16" }] })],
      [],
      "2026-07",
      "2026-07-20",
    );
    expect(month.occurrences).toHaveLength(1);
    expect(month.occurrences[0]).toMatchObject({
      status: "complete",
      matchedTransactionId: "txn-1",
      dueDate: "2026-07-15",
      amount: 15.49,
      isIncome: false,
    });
  });

  it("marks an unmatched past-due occurrence overdue and a future one upcoming", () => {
    const overdue = expandStreamsForMonth([stream()], [], "2026-07", "2026-07-20");
    expect(overdue.occurrences[0]!.status).toBe("overdue");

    const upcoming = expandStreamsForMonth([stream()], [], "2026-07", "2026-07-10");
    expect(upcoming.occurrences[0]!.status).toBe("upcoming");
  });

  it("excludes dismissed and tombstoned streams", () => {
    const month = expandStreamsForMonth(
      [
        stream({ id: "a", dismissedAt: "2026-07-01T00:00:00Z" }),
        stream({ id: "b", status: "TOMBSTONED" }),
      ],
      [],
      "2026-07",
      "2026-07-20",
    );
    expect(month.occurrences).toHaveLength(0);
  });

  it("skips streams with no usable anchor date", () => {
    const month = expandStreamsForMonth(
      [stream({ predictedNextDate: null, lastDate: null, firstDate: null })],
      [],
      "2026-07",
      "2026-07-20",
    );
    expect(month.occurrences).toHaveLength(0);
  });

  it("keeps credit-card purchases in expenses until actual card-bill data is available", () => {
    const month = expandStreamsForMonth(
      [
        stream({ id: "paycheck", streamType: "inflow", averageAmount: 3000 }),
        stream({ id: "card-purchase", averageAmount: 200 }),
        stream({ id: "rent", averageAmount: 1500, matchedTransactions: [{ id: "t", date: "2026-07-15" }] }),
      ],
      [],
      "2026-07",
      "2026-07-20",
    );
    expect(month.totals.income.remaining).toBe(3000);
    expect(month.totals.expenses.remaining).toBe(200);
    expect(month.totals.expenses.paid).toBe(1500);
    expect(month.totals.creditCards).toEqual({ paid: 0, remaining: 0 });
  });

  it("expands enabled manual items and skips disabled ones", () => {
    const month = expandStreamsForMonth(
      [],
      [
        {
          id: "manual-1",
          name: "Piano lessons",
          amount: 80,
          frequency: "monthly",
          nextDate: "2026-07-05",
          itemType: "expense",
          category: "Education",
          enabled: true,
        },
        {
          id: "manual-2",
          name: "Old gym",
          amount: 40,
          frequency: "monthly",
          nextDate: "2026-07-01",
          itemType: "expense",
          category: null,
          enabled: false,
        },
      ],
      "2026-07",
      "2026-07-01",
    );
    expect(month.occurrences).toHaveLength(1);
    expect(month.occurrences[0]).toMatchObject({ source: "manual", sourceId: "manual-1", category: "Education" });
    expect(month.occurrences[0]).not.toHaveProperty("dueDateType");
  });

  it("computes reviewCount independently of the viewed month's occurrences", () => {
    const month = expandStreamsForMonth(
      [stream({ reviewedAt: null }), stream({ id: "b", predictedNextDate: "2099-01-01", reviewedAt: null })],
      [],
      "2026-07",
      "2026-07-20",
    );
    expect(month.reviewCount).toBe(2);
  });

  it("excludes transfers/loan payments (EXCLUDED_PFC) from totals but still lists the occurrence (Fix 4)", () => {
    const month = expandStreamsForMonth(
      [
        stream({
          id: "card-autopay",
          category: "LOAN_PAYMENTS",
          averageAmount: 400,
        }),
      ],
      [],
      "2026-07",
      "2026-07-01",
    );
    expect(month.occurrences).toHaveLength(1);
    expect(month.occurrences[0]).toMatchObject({ sourceId: "card-autopay", category: "LOAN_PAYMENTS" });
    expect(month.totals.income.paid).toBe(0);
    expect(month.totals.income.remaining).toBe(0);
    expect(month.totals.expenses.paid).toBe(0);
    expect(month.totals.expenses.remaining).toBe(0);
    expect(month.totals.creditCards.paid).toBe(0);
    expect(month.totals.creditCards.remaining).toBe(0);
  });

  it("never lets one transaction complete two occurrences of a weekly stream", () => {
    // WEEKLY cadence is 7 days but its tolerance window is +/-5 days, so
    // adjacent due dates' windows overlap (2 * 5 > 7). A single matched
    // transaction landing in that overlap must complete only the nearer
    // occurrence, not both.
    const month = expandStreamsForMonth(
      [
        stream({
          frequency: "WEEKLY",
          predictedNextDate: "2026-07-08",
          averageAmount: 20,
          matchedTransactions: [{ id: "txn-1", date: "2026-07-04" }],
        }),
      ],
      [],
      "2026-07",
      "2026-07-20",
    );
    const completed = month.occurrences.filter((occurrence) => occurrence.status === "complete");
    expect(completed).toHaveLength(1);
    expect(month.totals.expenses.paid).toBe(20);
  });
});

describe("amount fallbacks", () => {
  it("renders a zero amount for a stream with no tracked amounts at all", () => {
    const month = expandStreamsForMonth(
      [stream({ userAmount: null, averageAmount: null, lastAmount: null })],
      [],
      "2026-07",
      "2026-07-20",
    );
    expect(month.occurrences[0]!.amount).toBe(0);
  });
});
