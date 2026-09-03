import { describe, expect, it } from "vitest";
import { isValidTransactionAccount, TRANSACTION_DATE_RE, MAX_TRANSACTION_AMOUNT } from "@/lib/transaction-validation";

describe("transaction-validation", () => {
  it("validates transaction accounts", () => {
    expect(isValidTransactionAccount({ source: "plaid", id: "acc-1" })).toBe(true);
    expect(isValidTransactionAccount({ source: "manual", id: "acc-2" })).toBe(true);
    expect(isValidTransactionAccount({ source: "other", id: "acc-1" })).toBe(false);
    expect(isValidTransactionAccount(undefined)).toBe(false);
    expect(isValidTransactionAccount({ source: "plaid", id: "" })).toBe(false);
  });

  it("exports valid constants", () => {
    expect(TRANSACTION_DATE_RE.test("2026-09-02")).toBe(true);
    expect(TRANSACTION_DATE_RE.test("2026/09/02")).toBe(false);
    expect(MAX_TRANSACTION_AMOUNT).toBe(1_000_000);
  });
});
