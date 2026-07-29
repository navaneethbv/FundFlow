import { describe, it, expect } from "vitest";
import { normalizeManualTxn } from "@/lib/manual-transaction";

describe("lib/manual-transaction.ts", () => {
  it("normalizes debit transactions with positive signed amount", () => {
    const res = normalizeManualTxn({
      kind: "debit",
      amount: 45.5,
      merchant: "Coffee Shop",
      date: "2026-07-29",
      account: { source: "plaid", id: "acc-1" },
    });

    expect(res.amount).toBe(45.5);
    expect(res.merchant).toBe("Coffee Shop");
    expect(res.accountId).toBe("acc-1");
    expect(res.manualAccountId).toBeNull();
  });

  it("normalizes credit transactions with negative signed amount", () => {
    const res = normalizeManualTxn({
      kind: "credit",
      amount: 100,
      merchant: "Refund Store",
      date: "2026-07-29",
      account: { source: "manual", id: "macc-1" },
    });

    expect(res.amount).toBe(-100);
    expect(res.manualAccountId).toBe("macc-1");
    expect(res.accountId).toBeNull();
  });
});
