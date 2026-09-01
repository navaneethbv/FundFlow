import { describe, expect, it } from "vitest";
import { buildCreditCardBucket, type CreditCardBill } from "@/lib/recurring-credit-bill";

describe("credit-card bill bucket", () => {
  const bills: CreditCardBill[] = [
    {
      accountId: "acc-1",
      statementBalance: 1200,
      minimumPayment: 25,
      dueDate: "2026-08-25",
    },
    {
      accountId: "acc-2",
      statementBalance: 400,
      minimumPayment: 15,
      dueDate: "2026-08-30",
    },
  ];

  it("populates the recurring credit-card bucket only from real bill data", () => {
    const bucket = buildCreditCardBucket(bills, "2026-08");
    expect(bucket).toEqual({ paid: 0, remaining: 1600 });
  });

  it("only counts bills due in the selected month", () => {
    const bucket = buildCreditCardBucket(bills, "2026-09");
    expect(bucket).toEqual({ paid: 0, remaining: 0 });
  });

  it("keeps the bucket empty when no real bill data exists", () => {
    expect(buildCreditCardBucket([], "2026-08")).toEqual({ paid: 0, remaining: 0 });
  });

  it("does not assign a bill without a due date to an arbitrary month", () => {
    expect(buildCreditCardBucket([
      { accountId: "acc-3", statementBalance: 50, minimumPayment: 10, dueDate: null },
    ], "2026-08")).toEqual({ paid: 0, remaining: 0 });
  });

  it("does not count the bill payment as spending", () => {
    // The bucket is separate from expenses; a bill payment is a transfer.
    const bucket = buildCreditCardBucket(bills, "2026-08");
    expect(bucket.remaining).toBe(1600);
    expect(bucket.paid).toBe(0);
  });
});
