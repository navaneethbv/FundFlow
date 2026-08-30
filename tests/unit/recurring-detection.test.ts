import { describe, expect, it } from "vitest";
import {
  detectRecurringCandidates,
  normalizeRecurringMerchant,
  recurringIdentityKey,
  RECURRING_DETECTION_VERSION,
  type DetectedRecurringCandidate,
  type RecurringDetectionTransaction,
} from "@/lib/recurring-detection";

const TODAY = "2026-09-01";

let sequenceCounter = 0;

/**
 * One fully populated detection fixture series. Every row gets a stable
 * unique id (`txn-<sequence>-<index>`) so deterministic tie-breaks and
 * single-use evidence assertions can name transactions exactly.
 */
function series(
  dates: readonly string[],
  amounts: readonly number[],
  overrides: Partial<RecurringDetectionTransaction> = {},
): RecurringDetectionTransaction[] {
  const sequence = sequenceCounter++;
  return dates.map((date, index) => ({
    id: `txn-${sequence}-${index}`,
    userId: "user-1",
    plaidItemId: "item-1",
    accountId: "account-1",
    postedDate: date,
    authorizedDate: null,
    amount: amounts[index] ?? amounts[amounts.length - 1] ?? 0,
    flow: "expense",
    merchant: "E2E LOCAL DETECT 130",
    rawName: null,
    category: null,
    detailedCategory: null,
    paymentChannel: "online",
    currency: "USD",
    ...overrides,
  }));
}

function oneCandidate(
  transactions: readonly RecurringDetectionTransaction[],
  today: string = TODAY,
): DetectedRecurringCandidate {
  const candidates = detectRecurringCandidates(transactions, today);
  expect(candidates).toHaveLength(1);
  return candidates[0]!;
}

describe("normalizeRecurringMerchant", () => {
  it("folds case, punctuation, and whitespace", () => {
    expect(normalizeRecurringMerchant("netflix, inc.")).toBe("NETFLIX INC");
  });

  it("strips transaction-specific reference and masked card tokens", () => {
    expect(normalizeRecurringMerchant("Spotify REF 482913 CARD 4242")).toBe("SPOTIFY");
    expect(normalizeRecurringMerchant("Comcast ID 555123 ACCT 0009")).toBe("COMCAST");
  });

  it("preserves meaningful merchant words", () => {
    expect(normalizeRecurringMerchant("The Home Depot #6120")).toBe("THE HOME DEPOT 6120");
  });

  it("collapses noisy suffixes into one stable identity", () => {
    expect(normalizeRecurringMerchant("HULU SUB 881234")).toBe("HULU SUB 881234");
    expect(normalizeRecurringMerchant("hulu   sub 881234")).toBe(normalizeRecurringMerchant("HULU SUB 881234"));
  });
});

describe("recurringIdentityKey", () => {
  it("changes with every identity component", () => {
    const base = {
      userId: "user-1",
      accountId: "account-1",
      streamType: "outflow" as const,
      merchantIdentity: "NETFLIX",
      frequency: "MONTHLY" as const,
    };
    const variants = [
      { ...base, accountId: "account-2" },
      { ...base, streamType: "inflow" as const },
      { ...base, merchantIdentity: "HULU" },
      { ...base, frequency: "WEEKLY" as const },
      { ...base, userId: "user-2" },
    ];
    const baseKey = recurringIdentityKey(base);
    for (const variant of variants) {
      expect(recurringIdentityKey(variant)).not.toBe(baseKey);
    }
  });

  it("is stable for identical inputs", () => {
    const input = {
      userId: "user-1",
      accountId: "account-1",
      streamType: "outflow" as const,
      merchantIdentity: "NETFLIX",
      frequency: "MONTHLY" as const,
    };
    expect(recurringIdentityKey(input)).toBe(recurringIdentityKey(input));
  });
});

describe("detectRecurringCandidates cadence thresholds", () => {
  it("accepts eight consecutive weekly occurrences inside eight weeks", () => {
    const candidate = oneCandidate(
      series(
        ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"],
        [12.99, 12.99, 12.99, 12.99, 12.99, 12.99, 12.99, 12.99],
      ),
    );
    expect(candidate.frequency).toBe("WEEKLY");
    expect(candidate.evidence.occurrenceCount).toBe(8);
    expect(candidate.amountPattern).toBe("fixed");
    expect(candidate.expectedAmount).toBe(12.99);
  });

  it("rejects a weekly sequence whose gap breaks continuity", () => {
    const candidates = detectRecurringCandidates(
      series(
        ["2026-07-06", "2026-07-13", "2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"],
        [12.99],
      ),
      TODAY,
    );
    // The 07-13 to 07-27 gap is 14 days: only the five trailing occurrences
    // stay consecutive, below the eight required for weekly.
    expect(candidates.filter((candidate) => candidate.frequency === "WEEKLY")).toHaveLength(0);
  });

  it("accepts four consecutive biweekly occurrences inside eight weeks", () => {
    const candidate = oneCandidate(
      series(["2026-07-01", "2026-07-15", "2026-07-29", "2026-08-12"], [24.0]),
    );
    expect(candidate.frequency).toBe("BIWEEKLY");
    expect(candidate.evidence.occurrenceCount).toBe(4);
  });

  it("accepts three monthly occurrences inside four months as a price step", () => {
    const candidate = oneCandidate(
      series(["2026-05-15", "2026-06-15", "2026-07-15"], [15.99, 15.99, 17.99]),
    );
    expect(candidate.frequency).toBe("MONTHLY");
    expect(candidate.amountPattern).toBe("price_step");
    expect(candidate.expectedAmount).toBe(17.99);
    expect(candidate.lastAmount).toBe(17.99);
  });

  it("accepts three quarterly occurrences inside ten months", () => {
    const candidate = oneCandidate(
      series(["2025-12-15", "2026-03-15", "2026-06-15"], [90.0]),
    );
    expect(candidate.frequency).toBe("QUARTERLY");
    expect(candidate.evidence.occurrenceCount).toBe(3);
  });

  it("never infers an annual stream", () => {
    const candidates = detectRecurringCandidates(
      series(["2024-08-15", "2025-08-15", "2026-08-15"], [120.0]),
      TODAY,
    );
    expect(candidates).toHaveLength(0);
  });

  it("keeps the posted date as the stream occurrence dates while using authorized dates for cadence", () => {
    const authorized = series(
      ["2026-06-15", "2026-07-16", "2026-08-15"],
      [10],
      { authorizedDate: null },
    );
    authorized.forEach((transaction, index) => {
      transaction.authorizedDate = ["2026-06-14", "2026-07-15", "2026-08-14"][index] ?? null;
    });
    const candidate = oneCandidate(authorized);
    expect(candidate.frequency).toBe("MONTHLY");
    expect(candidate.firstDate).toBe("2026-06-15");
    expect(candidate.lastDate).toBe("2026-08-15");
  });
});

describe("detectRecurringCandidates amount patterns", () => {
  it("accepts a bounded variable utility bill and forecasts the median", () => {
    const candidate = oneCandidate(
      series(["2026-06-10", "2026-07-10", "2026-08-10"], [80.0, 120.0, 100.0], {
        category: "UTILITIES",
      }),
    );
    expect(candidate.frequency).toBe("MONTHLY");
    expect(candidate.amountPattern).toBe("variable");
    expect(candidate.expectedAmount).toBe(100.0);
    expect(candidate.lastAmount).toBe(100.0);
  });

  it("rejects a variable-shaped food and drink merchant with no recurring signifier", () => {
    const candidates = detectRecurringCandidates(
      series(["2026-06-10", "2026-07-10", "2026-08-10"], [80.0, 120.0, 100.0], {
        category: "FOOD_AND_DRINK",
      }),
      TODAY,
    );
    expect(candidates).toHaveLength(0);
  });

  it("accepts a discretionary merchant as variable when a recurring signifier is present", () => {
    const candidate = oneCandidate(
      series(["2026-06-10", "2026-07-10", "2026-08-10"], [80.0, 120.0, 100.0], {
        category: "FOOD_AND_DRINK",
        rawName: "COFFEE CLUB SUBSCRIPTION 4455",
        merchant: "COFFEE CLUB",
      }),
    );
    expect(candidate.amountPattern).toBe("variable");
    expect(candidate.evidence.matchedSignifiers).toContain("SUBSCRIPTION");
  });

  it("rejects a variable stream when any occurrence exceeds 2.5x the median", () => {
    const candidates = detectRecurringCandidates(
      series(["2026-06-10", "2026-07-10", "2026-08-10"], [80.0, 120.0, 400.0], {
        category: "UTILITIES",
      }),
      TODAY,
    );
    expect(candidates).toHaveLength(0);
  });

  it("rejects an in-store variable purchase", () => {
    const candidates = detectRecurringCandidates(
      series(["2026-06-10", "2026-07-10", "2026-08-10"], [80.0, 120.0, 100.0], {
        category: "UTILITIES",
        paymentChannel: "in store",
      }),
      TODAY,
    );
    expect(candidates).toHaveLength(0);
  });
});

describe("detectRecurringCandidates isolation and determinism", () => {
  it("never merges transactions across accounts, users, directions, or currencies", () => {
    const base = series(["2026-06-15", "2026-07-15", "2026-08-15"], [30.0]);
    const isolated = [
      ...base,
      ...series(["2026-06-16", "2026-07-16", "2026-08-16"], [30.0], { accountId: "account-2" }),
      ...series(["2026-06-17", "2026-07-17", "2026-08-17"], [30.0], { userId: "user-2" }),
      ...series(["2026-06-18", "2026-07-18", "2026-08-18"], [30.0], { flow: "income" as const }),
      ...series(["2026-06-19", "2026-07-19", "2026-08-19"], [30.0], { currency: "EUR" }),
    ];
    const candidates = detectRecurringCandidates(isolated, TODAY);
    expect(candidates).toHaveLength(5);
    // Partitions never merge transactions: every selected candidate is
    // backed by disjoint transaction evidence. (The EUR group legitimately
    // shares the base group's identity hash, which excludes currency, but
    // one account only ever holds one currency in real data.)
    const usedIds = candidates.flatMap((candidate) => candidate.transactionIds);
    expect(new Set(usedIds).size).toBe(usedIds.length);
  });

  it("skips transactions with an empty normalized identity", () => {
    const candidates = detectRecurringCandidates(
      series(["2026-06-15", "2026-07-15", "2026-08-15"], [30.0], { merchant: "###" }),
      TODAY,
    );
    expect(candidates).toHaveLength(0);
  });

  it("ignores non-positive amounts", () => {
    const candidates = detectRecurringCandidates(
      series(["2026-06-15", "2026-07-15", "2026-08-15"], [0, 30.0, 30.0]),
      TODAY,
    );
    expect(candidates).toHaveLength(0);
  });

  it("produces hashed stream ids without readable merchant text", () => {
    const candidate = oneCandidate(series(["2026-06-15", "2026-07-15", "2026-08-15"], [30.0]));
    expect(candidate.streamId).toMatch(/^inferred:[0-9a-f]{64}$/);
    expect(candidate.streamId).not.toContain("RECURRING");
    expect(candidate.identityKey).toMatch(/^[0-9a-f]{64}$/);
    expect(RECURRING_DETECTION_VERSION).toBe(1);
  });

  it("ranks deterministically and lets one transaction support only one stream", () => {
    // Eight weekly occurrences of one merchant could support overlapping
    // candidates; single-use evidence means each transaction appears in at
    // most one selected candidate.
    const weekly = series(
      ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"],
      [12.99],
    );
    const candidates = detectRecurringCandidates(weekly, TODAY);
    const usedIds = candidates.flatMap((candidate) => candidate.transactionIds);
    expect(new Set(usedIds).size).toBe(usedIds.length);
    // Deterministic ranking: identical input yields identical output order.
    const again = detectRecurringCandidates(weekly, TODAY);
    expect(again.map((candidate) => candidate.streamId)).toEqual(
      candidates.map((candidate) => candidate.streamId),
    );
  });

  it("predicts the next occurrence with calendar-aware month arithmetic", () => {
    const candidate = oneCandidate(series(["2026-06-15", "2026-07-15", "2026-08-15"], [30.0]));
    expect(candidate.predictedNextDate).toBe("2026-09-15");
  });

  it("reports one-use evidence and the maximum cadence deviation", () => {
    const candidate = oneCandidate(
      series(["2026-05-15", "2026-06-15", "2026-07-15"], [15.99, 15.99, 17.99]),
    );
    expect(candidate.evidence).toEqual({
      occurrenceCount: 3,
      amountPattern: "price_step",
      maximumCadenceDeviationDays: 1,
      matchedSignifiers: [],
    });
  });
});
