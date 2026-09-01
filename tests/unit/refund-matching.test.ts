import { describe, expect, it } from "vitest";
import { detectRefundPairs } from "@/lib/transaction-quality";

describe("detectRefundPairs", () => {
  it("rejects refund dated before charge (reproduces production defect)", () => {
    const transactions = [
      {
        id: "txn-charge",
        date: "2026-08-19",
        amount: 45.0,
        merchant: "Amazon",
        category: "Shopping",
        accountId: "acc-1",
      },
      {
        id: "txn-refund",
        date: "2026-08-18",
        amount: -45.0,
        merchant: "Amazon",
        category: "Shopping",
        accountId: "acc-1",
      },
    ];

    const pairs = detectRefundPairs(transactions, 30);
    expect(pairs).toHaveLength(0);
  });

  it("pairs refund dated on or after charge within window", () => {
    const transactions = [
      {
        id: "txn-charge",
        date: "2026-08-19",
        amount: 45.0,
        merchant: "Amazon",
        category: "Shopping",
        accountId: "acc-1",
      },
      {
        id: "txn-refund",
        date: "2026-08-21",
        amount: -45.0,
        merchant: "Amazon",
        category: "Shopping",
        accountId: "acc-1",
      },
    ];

    const pairs = detectRefundPairs(transactions, 30);
    expect(pairs).toEqual([
      {
        chargeId: "txn-charge",
        refundId: "txn-refund",
        amount: 45.0,
      },
    ]);
  });

  it("pairs same-day refund", () => {
    const transactions = [
      {
        id: "txn-charge",
        date: "2026-08-19",
        amount: 30.0,
        merchant: "Target",
        category: "Shopping",
        accountId: "acc-1",
      },
      {
        id: "txn-refund",
        date: "2026-08-19",
        amount: -30.0,
        merchant: "Target",
        category: "Shopping",
        accountId: "acc-1",
      },
    ];

    const pairs = detectRefundPairs(transactions, 30);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.chargeId).toBe("txn-charge");
    expect(pairs[0]!.refundId).toBe("txn-refund");
  });
});
