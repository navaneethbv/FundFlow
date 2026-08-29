import { describe, expect, it } from "vitest";
import { projectFinanceTransactions, type RawFinanceTransaction } from "@/lib/finance-domain";
import { looksLikeMonarchCsv, parseMonarchCsv } from "@/lib/import";

describe("Phase 3: Transaction overrides and Monarch import", () => {
  describe("projectFinanceTransactions with transaction-level overrides", () => {
    it("allows overriding a TRANSFER_OUT transaction into spending without changing raw facts", () => {
      const rawRow: RawFinanceTransaction = {
        id: "tx-jewelry",
        providerTransactionId: "plaid-tx-jewelry",
        userId: "user-1",
        accountId: "acc-checking",
        manualAccountId: null,
        amount: 2500, // money out
        date: "2026-08-15",
        name: "Jewelry Store Transfer",
        merchant: "Jewelry Store",
        pfcPrimary: "TRANSFER_OUT",
        pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
        pending: false,
        source: "plaid",
      };

      // 1. Without override: classified as transfer
      const defaultProjected = projectFinanceTransactions({
        rows: [rawRow],
        merchantRules: [],
        categoryOverrides: [],
        splits: [],
        linkedRefunds: [],
      });
      expect(defaultProjected[0]?.flow).toBe("transfer");
      expect(defaultProjected[0]?.groupKey).toBe("TRANSFER_OUT");

      // 2. With per-transaction override: classified as expense / Shopping
      const overriddenProjected = projectFinanceTransactions({
        rows: [rawRow],
        merchantRules: [],
        categoryOverrides: [],
        splits: [],
        linkedRefunds: [],
        transactionOverrides: new Map([
          ["tx-jewelry", { category: "Shopping", flow: "expense" }],
        ]),
      });
      expect(overriddenProjected[0]?.flow).toBe("expense");
      expect(overriddenProjected[0]?.groupKey).toBe("Shopping");
      // Raw provider facts remain intact
      expect(rawRow.pfcPrimary).toBe("TRANSFER_OUT");
    });
  });

  describe("Monarch CSV Import", () => {
    it("detects and parses Monarch CSV export with category and negative amount mapping", () => {
      const csv = `Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags
2026-08-15,Jewelry Store,Shopping,Checking,JEWELRY STORE 123,,-2500.00,Special`;

      expect(looksLikeMonarchCsv(["date", "merchant", "category", "account", "original statement", "notes", "amount", "tags"])).toBe(true);

      const parsed = parseMonarchCsv(csv);
      expect(parsed.rows).toHaveLength(1);
      const row = parsed.rows[0]!;
      expect(row.merchant).toBe("Jewelry Store");
      expect(row.category).toBe("Shopping");
      expect(row.sourceAccount).toBe("Checking");
      // Monarch positive amount = spending (money out in Plaid sign convention)
      expect(row.amount).toBe(2500);
    });
  });
});
