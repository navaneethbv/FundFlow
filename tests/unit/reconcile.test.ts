import { describe, it, expect } from "vitest";
import {
  computeReconciliation,
  parseAccountRef,
} from "@/lib/reconcile";

const TXNS = [
  { id: "a", date: "2026-08-01", amount: 50, cleared: true, merchant: "Gas" },
  { id: "b", date: "2026-08-05", amount: 20, cleared: false, merchant: "Coffee" },
  { id: "c", date: "2026-08-10", amount: -2000, cleared: true, merchant: "Paycheck" },
  { id: "d", date: "2026-09-01", amount: 999, cleared: false, merchant: "After statement" },
];

describe("computeReconciliation", () => {
  it("splits cleared and outstanding within the statement window (asset)", () => {
    const result = computeReconciliation({
      direction: -1,
      bookBalance: 1850,
      statementBalance: 1930,
      statementDate: "2026-08-31",
      transactions: TXNS,
    });
    // Asset: spending decreases the balance, so a charge's delta is negative.
    expect(result.clearedTotal).toBe(1950); // -50 + 2000
    expect(result.outstandingTotal).toBe(-20);
    expect(result.clearedCount).toBe(2);
    expect(result.outstandingCount).toBe(1);
    expect(result.difference).toBe(-80); // book 1850 - statement 1930
    expect(result.balanced).toBe(false);
  });

  it("reads as balanced at zero difference", () => {
    const result = computeReconciliation({
      direction: -1,
      bookBalance: 1930,
      statementBalance: 1930,
      statementDate: "2026-08-31",
      transactions: TXNS,
    });
    expect(result.balanced).toBe(true);
  });

  it("direction flips the sums for liability accounts", () => {
    const result = computeReconciliation({
      direction: 1,
      bookBalance: 500,
      statementBalance: 500,
      statementDate: "2026-08-31",
      transactions: [TXNS[0]!, TXNS[1]!],
    });
    // Liability: a charge increases what you owe, so deltas keep the sign.
    expect(result.clearedTotal).toBe(50);
    expect(result.outstandingTotal).toBe(20);
  });

  it("rounds the difference to cents", () => {
    const result = computeReconciliation({
      direction: -1,
      bookBalance: 100.01,
      statementBalance: 100,
      statementDate: "2026-08-31",
      transactions: [],
    });
    expect(result.difference).toBe(0.01);
  });
});

describe("parseAccountRef", () => {
  it("accepts plaid and manual references", () => {
    expect(parseAccountRef("plaid:abc-1")).toEqual({ source: "plaid", id: "abc-1" });
    expect(parseAccountRef("manual:m1")).toEqual({ source: "manual", id: "m1" });
  });

  it("rejects malformed references", () => {
    expect(parseAccountRef("cash:m1")).toBeNull();
    expect(parseAccountRef("plaid:")).toBeNull();
    expect(parseAccountRef(null)).toBeNull();
    expect(parseAccountRef(42)).toBeNull();
  });
});
