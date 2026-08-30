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
      "2026-08-30",
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
    expect(result[0]).toMatchObject({ frequency: "WEEKLY", firstDate: "2026-07-08", lastDate: "2026-08-26" });
  });

  it("isolates account, user, item, direction, and currency boundaries", () => {
    const base = series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99);
    const mixed = [...base, ...series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99, { accountId: "account-2", idPrefix: "account-2" }), ...series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99, { flow: "income", idPrefix: "income" })];
    expect(detectRecurringCandidates(mixed, "2026-08-30")).toHaveLength(3);
  });

  it("rejects empty identities and extreme variable outliers", () => {
    expect(detectRecurringCandidates(series(["2026-05-15", "2026-06-15", "2026-07-15"], 10, { merchant: "***", rawName: "***" }), "2026-08-30")).toEqual([]);
    expect(detectRecurringCandidates(series(["2026-05-15", "2026-06-15", "2026-07-15"], [80, 100, 300], { category: "UTILITY" }), "2026-08-30")).toEqual([]);
  });

  it("returns deterministic candidates and does not reuse transaction evidence", () => {
    const input = [
      ...series(["2026-05-15", "2026-06-15", "2026-07-15"], [80, 100, 90], { category: "UTILITY", merchant: "Power Co", rawName: "Power Co", idPrefix: "power" }),
      ...series(["2026-05-15", "2026-06-15", "2026-07-15"], 15.99, { merchant: "Other Co", rawName: "Other Co", idPrefix: "other" }),
    ];
    const first = detectRecurringCandidates([...input].reverse(), "2026-08-30");
    const second = detectRecurringCandidates(input, "2026-08-30");
    expect(first).toEqual(second);
    expect(new Set(first.flatMap((candidate) => candidate.transactionIds)).size).toBe(
      first.reduce((total, candidate) => total + candidate.transactionIds.length, 0),
    );
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
