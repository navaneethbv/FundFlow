import { describe, expect, it } from "vitest";
import {
  projectFinanceTransactions,
  type ProjectFinanceInput,
  type RawFinanceTransaction,
} from "@/lib/finance-domain";

const baseInput: Omit<ProjectFinanceInput, "rows"> = {
  merchantRules: [],
  categoryOverrides: [],
  splits: [],
  linkedRefunds: [],
};

function row(over: Partial<RawFinanceTransaction> = {}): RawFinanceTransaction {
  return {
    id: "txn-1",
    providerTransactionId: "plaid-1",
    userId: "user-1",
    accountId: "acct-1",
    manualAccountId: null,
    date: "2026-08-01",
    amount: 120,
    merchant: "Example Retailer",
    name: "RETAIL PURCHASE",
    pfcPrimary: "TRANSFER_OUT",
    pfcDetailed: "TRANSFER_OUT",
    pending: false,
    source: "plaid",
    ...over,
  };
}

describe("transaction-level classification overrides", () => {
  it("corrects a provider transfer into spending with an explicit override", () => {
    const result = projectFinanceTransactions({
      ...baseInput,
      rows: [row()],
      transactionOverrides: [
        {
          transactionId: "txn-1",
          displayCategory: "SHOPPING",
          cashFlowClassification: "expense",
        },
      ],
    });
    expect(result[0]).toMatchObject({
      flow: "expense",
      groupKey: "SHOPPING",
      categoryKey: "SHOPPING",
      signedAmount: 120,
    });
  });

  it("corrects a provider transfer into income", () => {
    const result = projectFinanceTransactions({
      ...baseInput,
      rows: [row({ amount: -400, pfcPrimary: "TRANSFER_IN", pfcDetailed: "TRANSFER_IN" })],
      transactionOverrides: [
        {
          transactionId: "txn-1",
          displayCategory: "INCOME_REFUND",
          cashFlowClassification: "income",
        },
      ],
    });
    expect(result[0]).toMatchObject({ flow: "income", groupKey: "INCOME_REFUND" });
  });

  it("keeps the provider transfer classification when only a display category is set", () => {
    const result = projectFinanceTransactions({
      ...baseInput,
      rows: [row()],
      transactionOverrides: [
        { transactionId: "txn-1", displayCategory: "SHOPPING", cashFlowClassification: null },
      ],
    });
    expect(result[0].flow).toBe("transfer");
  });

  it("applies the override exactly once for a split parent", () => {
    const result = projectFinanceTransactions({
      ...baseInput,
      rows: [row()],
      splits: [
        { transactionId: "txn-1", category: "RETAIL_A", amount: 50 },
        { transactionId: "txn-1", category: "RETAIL_B", amount: 70 },
      ],
      transactionOverrides: [
        {
          transactionId: "txn-1",
          displayCategory: "SHOPPING",
          cashFlowClassification: "expense",
        },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result.every((part) => part.flow === "expense")).toBe(true);
    expect(result.every((part) => part.groupKey === "SHOPPING")).toBe(true);
  });

  it("leaves global transfer exclusions intact for non-overridden rows", () => {
    const result = projectFinanceTransactions({
      ...baseInput,
      rows: [
        row({ id: "txn-transfer", providerTransactionId: "p2" }),
        row({ id: "txn-expense", providerTransactionId: "p3", pfcPrimary: "SHOPS", pfcDetailed: "SHOPS_OTHER" }),
      ],
      transactionOverrides: [
        { transactionId: "txn-expense", displayCategory: "CLOTHING", cashFlowClassification: null },
      ],
    });
    const transfer = result.find((r) => r.sourceTransactionId === "txn-transfer")!;
    expect(transfer.flow).toBe("transfer");
    expect(transfer.groupKey).toBe("TRANSFER_OUT");
    const expense = result.find((r) => r.sourceTransactionId === "txn-expense")!;
    expect(expense.flow).toBe("expense");
    expect(expense.groupKey).toBe("CLOTHING");
  });

  it("keeps loan payments excluded unless the user explicitly reclassifies", () => {
    const result = projectFinanceTransactions({
      ...baseInput,
      rows: [row({ pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS" })],
      transactionOverrides: [
        {
          transactionId: "txn-1",
          displayCategory: "DEBT_REPAYMENT",
          cashFlowClassification: "expense",
        },
      ],
    });
    expect(result[0].flow).toBe("expense");
    expect(result[0].groupKey).toBe("DEBT_REPAYMENT");
  });

  it("does not apply an override to a different transaction", () => {
    const result = projectFinanceTransactions({
      ...baseInput,
      rows: [
        row({ id: "txn-1" }),
        row({ id: "txn-2", providerTransactionId: "p2" }),
      ],
      transactionOverrides: [
        {
          transactionId: "txn-1",
          displayCategory: "SHOPPING",
          cashFlowClassification: "expense",
        },
      ],
    });
    const other = result.find((r) => r.sourceTransactionId === "txn-2")!;
    expect(other.flow).toBe("transfer");
    expect(other.groupKey).toBe("TRANSFER_OUT");
  });
});
