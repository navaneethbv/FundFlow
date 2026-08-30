import { describe, expect, it } from "vitest";
import {
  detectRecurringCandidates,
  normalizeRecurringMerchant,
  recurringIdentityKey,
  type RecurringDetectionTransaction,
} from "@/lib/recurring-detection";

type Overrides = Partial<Omit<RecurringDetectionTransaction, "id" | "postedDate" | "amount">> & { idPrefix?: string };

function series(
  dates: readonly string[],
  amounts: readonly number[] | number,
  overrides: Overrides = {},
): RecurringDetectionTransaction[] {
  const { idPrefix = "txn", ...transactionOverrides } = overrides;
  return dates.map((postedDate, index) => ({
    id: `${idPrefix}-${index + 1}`,
    userId: "user-1",
    plaidItemId: "item-1",
    accountId: "account-1",
    postedDate,
    authorizedDate: null,
    amount: typeof amounts === "number" ? amounts : amounts[index] ?? amounts[amounts.length - 1] ?? 0,
    flow: "expense",
    merchant: "Acme Streaming",
    rawName: "Acme Streaming",
    category: "ENTERTAINMENT",
    detailedCategory: "STREAMING_SERVICES",
    paymentChannel: "online",
    currency: "USD",
    ...transactionOverrides,
  }));
}

describe("normalizeRecurringMerchant", () => {
  it("normalizes punctuation, compatibility characters, and noisy reference suffixes", () => {
    expect(normalizeRecurringMerchant("  Ａcme\u2122   REF 123456  ")).toBe("ACME");
    expect(normalizeRecurringMerchant("Acme * ID 9876")).toBe("ACME");
  });

  it("keeps meaningful merchant words and rejects no identity", () => {
    expect(normalizeRecurringMerchant("Netflix Family Plan")).toBe("NETFLIX FAMILY PLAN");
    expect(normalizeRecurringMerchant("***")).toBe("");
  });
});

describe("detectRecurringCandidates", () => {
  it("detects eight consecutive weekly occurrences", () => {
    const result = detectRecurringCandidates(
      series(["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"], 12.99),
      "2026-08-30",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ frequency: "WEEKLY", amountPattern: "fixed", expectedAmount: 12.99 });
    expect(result[0]!.evidence).toMatchObject({ occurrenceCount: 8, maximumCadenceDeviationDays: 0 });
  });

  it("breaks weekly continuity at a missing occurrence", () => {
    const result = detectRecurringCandidates(
      series(["2026-07-06", "2026-07-13", "2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"], 12.99),
      "2026-08-31",
    );
    expect(result).toEqual([]);
  });

  it("detects biweekly, monthly price-step, and quarterly sequences", () => {
    const biweekly = detectRecurringCandidates(
      series(["2026-07-01", "2026-07-15", "2026-07-29", "2026-08-12"], 24),
      "2026-08-26",
    );
    expect(biweekly[0]).toMatchObject({ frequency: "BIWEEKLY", amountPattern: "fixed" });

    const monthly = detectRecurringCandidates(
      series(["2026-05-15", "2026-06-15", "2026-07-15"], [15.99, 15.99, 17.99]),
      "2026-08-30",
    );
    expect(monthly[0]).toMatchObject({ frequency: "MONTHLY", amountPattern: "price_step", expectedAmount: 17.99, lastAmount: 17.99 });

    const quarterly = detectRecurringCandidates(
      series(["2025-12-15", "2026-03-15", "2026-06-15"], 90),
      "2026-08-30",
    );
    expect(quarterly[0]).toMatchObject({ frequency: "QUARTERLY", amountPattern: "fixed", expectedAmount: 90 });
  });

  it("never infers annual sequences", () => {
    expect(
      detectRecurringCandidates(series(["2024-08-15", "2025-08-15", "2026-08-15"], 120), "2026-08-30"),
    ).toEqual([]);
  });

  it("allows bounded variable utility bills but rejects variable coffee and in-store charges", () => {
    const utility = detectRecurringCandidates(
      series(["2026-05-15", "2026-06-15", "2026-07-15"], [80, 120, 100], { category: "RENT_AND_UTILITIES" }),
      "2026-08-30",
    );
    expect(utility[0]).toMatchObject({ amountPattern: "variable", expectedAmount: 100 });

    const coffee = detectRecurringCandidates(
      series(["2026-05-15", "2026-06-15", "2026-07-15"], [80, 120, 100], { category: "FOOD_AND_DRINK", detailedCategory: "COFFEE" }),
      "2026-08-30",
    );
    expect(coffee).toEqual([]);

    expect(
      detectRecurringCandidates(
        series(["2026-05-15", "2026-06-15", "2026-07-15"], [80, 120, 100], { category: "RENT_AND_UTILITIES", paymentChannel: "in store" }),
        "2026-08-30",
      ),
    ).toEqual([]);
  });

  it("uses authorized dates for cadence while retaining posted occurrence dates", () => {
    const result = detectRecurringCandidates(
      series(["2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29", "2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26"], 12.99, {
        authorizedDate: null,
      }).map((transaction, index) => ({
        ...transaction,
        authorizedDate: ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"][index] ?? null,
      })),
      "2026-08-30",
    );
    expect(result[0]).toMatchObject({ frequency: "WEEKLY", firstDate: "2026-07-08", lastDate: "2026-08-26", predictedNextDate: "2026-08-31" });
  });

  it("isolates account, user, item, direction, and currency boundaries", () => {
    const base = series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99);
    const mixed = [
      ...base,
      ...series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99, { accountId: "account-2", idPrefix: "account-2" }),
      ...series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99, { flow: "income", idPrefix: "income" }),
      ...series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99, { userId: "user-2", idPrefix: "user-2" }),
      ...series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99, { plaidItemId: "item-2", idPrefix: "item-2" }),
      ...series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99, { currency: "EUR", idPrefix: "eur" }),
    ];
    expect(detectRecurringCandidates(mixed, "2026-08-30")).toHaveLength(6);
  });

  it("rejects empty identities and extreme variable outliers", () => {
    expect(detectRecurringCandidates(series(["2026-05-15", "2026-06-15", "2026-07-15"], 10, { merchant: "***", rawName: "***" }), "2026-08-30")).toEqual([]);
    expect(detectRecurringCandidates(series(["2026-05-15", "2026-06-15", "2026-07-15"], [80, 100, 300], { category: "UTILITY" }), "2026-08-30")).toEqual([]);
  });

  it("rejects stale history and keeps only the most recent complete sequence", () => {
    const stale = detectRecurringCandidates(
      series(["2025-03-15", "2025-04-15", "2025-05-15"], 15.99, { idPrefix: "stale" }),
      "2026-08-14",
    );
    expect(stale).toEqual([]);

    const result = detectRecurringCandidates(
      [
        ...series(["2026-05-01", "2026-05-27", "2026-06-22"], 15.99, { idPrefix: "first" }),
        ...series(["2026-06-23", "2026-07-19", "2026-08-14"], 15.99, { idPrefix: "second" }),
      ],
      "2026-08-14",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ firstDate: "2026-06-23", lastDate: "2026-08-14" });
    expect(result[0]!.transactionIds).toEqual(["second-1", "second-2", "second-3"]);
    expect(new Set(result.map((candidate) => candidate.identityKey)).size).toBe(1);
  });

  it("rejects a monthly sequence with an older supporting occurrence outside today window", () => {
    const result = detectRecurringCandidates(
      series(["2026-04-15", "2026-05-15", "2026-06-15"], 15.99),
      "2026-10-14",
    );
    expect(result).toEqual([]);
  });

  it("ranks competing candidates by amount strength and does not reuse evidence", () => {
    const input = [
      ...series(["2026-05-15", "2026-06-15", "2026-07-15"], [80, 100, 90], { category: "UTILITY", merchant: "Power Co", rawName: "Power Co", idPrefix: "power" }),
      ...series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99, { merchant: "Other Co", rawName: "Other Co", idPrefix: "other" }),
    ];
    const first = detectRecurringCandidates([...input].reverse(), "2026-08-30");
    const second = detectRecurringCandidates(input, "2026-08-30");
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({ merchantName: "Other Co", amountPattern: "fixed" });
    expect(new Set(first.flatMap((candidate) => candidate.transactionIds)).size).toBe(
      first.reduce((total, candidate) => total + candidate.transactionIds.length, 0),
    );
  });

  it("ranks by occurrence count, cadence deviation, and stable transaction IDs", () => {
    const moreOccurrences = detectRecurringCandidates(
      series(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"], 10, { merchant: "More Co", rawName: "More Co", idPrefix: "more" }),
      "2026-08-30",
    );
    const fewerOccurrences = detectRecurringCandidates(
      series(["2026-05-01", "2026-06-01", "2026-07-01"], 10, { merchant: "Fewer Co", rawName: "Fewer Co", idPrefix: "fewer" }),
      "2026-08-30",
    );
    expect(moreOccurrences[0]!.evidence.occurrenceCount).toBe(4);
    expect(fewerOccurrences[0]!.evidence.occurrenceCount).toBe(3);
    const occurrenceRanked = detectRecurringCandidates(
      [
        ...series(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"], 10, { merchant: "More Co", rawName: "More Co", idPrefix: "more" }),
        ...series(["2026-05-01", "2026-06-01", "2026-07-01"], 10, { merchant: "Fewer Co", rawName: "Fewer Co", idPrefix: "fewer" }),
      ],
      "2026-08-30",
    );
    expect(occurrenceRanked[0]).toMatchObject({ merchantName: "More Co" });

    const candidates = detectRecurringCandidates(
      [
        ...series(["2026-05-01", "2026-06-01", "2026-07-01"], 10, { merchant: "Exact Co", rawName: "Exact Co", idPrefix: "z" }),
        ...series(["2026-05-01", "2026-05-28", "2026-06-28"], 10, { merchant: "Irregular Co", rawName: "Irregular Co", idPrefix: "y" }),
        ...series(["2026-05-01", "2026-06-01", "2026-07-01"], 10, { merchant: "Alpha Co", rawName: "Alpha Co", idPrefix: "a" }),
      ],
      "2026-08-30",
    );
    expect(candidates.map((candidate) => candidate.merchantName)).toEqual(["Alpha Co", "Exact Co", "Irregular Co"]);
  });

  it("deduplicates repeated transaction evidence before selecting a stream", () => {
    const rows = series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99);
    const result = detectRecurringCandidates([...rows, ...rows], "2026-08-30");
    expect(result).toHaveLength(1);
    expect(result[0]!.transactionIds).toEqual(["txn-1", "txn-2", "txn-3"]);
  });

  it("clamps month-end predictions to the target month", () => {
    const result = detectRecurringCandidates(
      series(["2026-01-31", "2026-02-28", "2026-03-31"], 15.99),
      "2026-04-01",
    );
    expect(result[0]).toMatchObject({ frequency: "MONTHLY", predictedNextDate: "2026-04-30" });
  });

  it("clamps quarter-end predictions to the target month", () => {
    const result = detectRecurringCandidates(
      series(["2025-05-31", "2025-08-31", "2025-11-30"], 90),
      "2025-12-01",
    );
    expect(result[0]).toMatchObject({ frequency: "QUARTERLY", predictedNextDate: "2026-02-28" });
  });
});

describe("recurringIdentityKey", () => {
  it("hashes stable boundaries and cadence without exposing merchant text", () => {
    const key = recurringIdentityKey("user-1", "account-1", "outflow", "Acme Streaming", "MONTHLY");
    expect(key).toMatch(/^recurring-v1:[a-f0-9]{64}$/);
    expect(key).not.toContain("ACME");
    expect(key).toBe(recurringIdentityKey("user-1", "account-1", "outflow", "ACME STREAMING", "MONTHLY"));
    expect(key).not.toBe(recurringIdentityKey("user-1", "account-2", "outflow", "Acme Streaming", "MONTHLY"));
  });
});

describe("detectRecurringCandidates defensive filters", () => {
  it("rejects a malformed today anchor outright", () => {
    expect(
      detectRecurringCandidates(series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99), "08/30/2026"),
    ).toEqual([]);
  });

  it("drops rows with impossible calendar dates, invalid authorized dates, or future postings", () => {
    expect(
      detectRecurringCandidates(series(["2026-02-30", "2026-06-15", "2026-07-15"], 15.99), "2026-08-30"),
    ).toEqual([]);
    expect(
      detectRecurringCandidates(
        series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99).map((row, index) => ({
          ...row,
          authorizedDate: index === 1 ? "2026-06-31" : null,
        })),
        "2026-08-30",
      ),
    ).toEqual([]);
    expect(
      detectRecurringCandidates(series(["2026-09-15", "2026-10-15", "2026-11-15"], 15.99), "2026-08-30"),
    ).toEqual([]);
  });

  it("drops rows with zero, negative, or non-finite amounts", () => {
    expect(
      detectRecurringCandidates(series(["2026-05-15", "2026-06-15", "2026-07-15"], 0), "2026-08-30"),
    ).toEqual([]);
    expect(
      detectRecurringCandidates(
        series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99).map((row, index) => ({
          ...row,
          amount: index === 2 ? Number.NaN : row.amount,
        })),
        "2026-08-30",
      ),
    ).toEqual([]);
  });

  it("falls back to rawName for identity and display, and rejects rows with no identity at all", () => {
    const fallback = detectRecurringCandidates(
      series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99, { merchant: "   ", rawName: "Backup Name" }),
      "2026-08-30",
    );
    expect(fallback).toHaveLength(1);
    expect(fallback[0]).toMatchObject({ merchantName: "Backup Name", description: "Backup Name" });

    expect(
      detectRecurringCandidates(
        series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99, { merchant: "   ", rawName: "  " }),
        "2026-08-30",
      ),
    ).toEqual([]);
  });

  it("treats a missing currency as its own partition and accepts a fixed in-store sequence", () => {
    const result = detectRecurringCandidates(
      series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99, { currency: null, paymentChannel: "in store" }),
      "2026-08-30",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ amountPattern: "fixed" });
  });

  it("maps income flow to inflow streams", () => {
    const result = detectRecurringCandidates(
      series(["2026-05-15", "2026-06-15", "2026-07-15"], 3000, { flow: "income" }),
      "2026-08-30",
    );
    expect(result[0]).toMatchObject({ streamType: "inflow" });
  });

  it("unlocks the variable pattern through a recurring signifier alone and forecasts the even-count median", () => {
    const result = detectRecurringCandidates(
      series(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"], [80, 100, 120, 90], {
        category: "FOOD_AND_DRINK",
        detailedCategory: "COFFEE",
        rawName: "Acme Streaming SUBSCRIPTION",
      }),
      "2026-08-30",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      amountPattern: "variable",
      expectedAmount: 95,
    });
    expect(result[0]!.evidence.matchedSignifiers).toContain("SUBSCRIPTION");
  });

  it("falls back through newest category, newest detailed category, and oldest category", () => {
    const rows = series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99);
    const newestBlank = rows.map((row, index) =>
      index === 2 ? { ...row, category: null, detailedCategory: null } : row,
    );
    const result = detectRecurringCandidates(newestBlank, "2026-08-30");
    expect(result[0]!.category).toBe("ENTERTAINMENT");
  });

  it("predicts biweekly and weekly next dates from the newest effective occurrence", () => {
    const biweekly = detectRecurringCandidates(
      series(["2026-07-01", "2026-07-15", "2026-07-29", "2026-08-12"], 24),
      "2026-08-26",
    );
    expect(biweekly[0]).toMatchObject({ predictedNextDate: "2026-08-26" });

    const weekly = detectRecurringCandidates(
      series(["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"], 12.99),
      "2026-08-30",
    );
    expect(weekly[0]).toMatchObject({ predictedNextDate: "2026-08-31" });
  });
});

describe("recurringIdentityKey overloads and display fallbacks", () => {
  it("accepts the object overload and agrees with the positional form", () => {
    expect(
      recurringIdentityKey({
        userId: "user-1",
        accountId: "account-1",
        streamType: "outflow",
        merchant: "Acme Streaming",
        frequency: "MONTHLY",
      }),
    ).toBe(recurringIdentityKey("user-1", "account-1", "outflow", "Acme Streaming", "MONTHLY"));
  });

  it("falls back to detailed category and the merchant name for description when rawName is absent", () => {
    const rows = series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99).map((row, index) =>
      index === 2 ? { ...row, category: null, detailedCategory: "STREAMING_SERVICES", rawName: null } : { ...row, rawName: null },
    );
    const result = detectRecurringCandidates(rows, "2026-08-30");
    expect(result[0]).toMatchObject({ category: "STREAMING_SERVICES", description: "Acme Streaming" });
  });

  it("accepts a variable bill with no payment channel and reads signifiers from the merchant alone", () => {
    const result = detectRecurringCandidates(
      series(["2026-05-15", "2026-06-15", "2026-07-15"], [80, 120, 100], {
        category: null,
        detailedCategory: null,
        paymentChannel: null,
        rawName: null,
        merchant: "Acme Utilities AUTOPAY",
      }),
      "2026-08-30",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ amountPattern: "variable", expectedAmount: 100 });
    expect(result[0]!.evidence.matchedSignifiers).toContain("AUTOPAY");
  });
});
