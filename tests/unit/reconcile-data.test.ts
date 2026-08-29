import { describe, expect, it, vi } from "vitest";
import {
  buildAccountReconciliationRows,
  loadAccountReconciliation,
} from "@/lib/reconcile-data";

describe("reconcile-data tests", () => {
  describe("buildAccountReconciliationRows", () => {
    const now = new Date("2026-08-29T12:00:00.000Z");

    it("computes balances, difference, and coverage window for checking and credit accounts", () => {
      const accounts = [
        {
          id: "acc-checking",
          name: "Primary Checking",
          type: "depository",
          subtype: "checking",
          current_balance: 5000,
          iso_currency_code: "USD",
          plaid_item_id: "item-1",
          updated_at: "2026-08-29T11:00:00.000Z",
        },
        {
          id: "acc-card",
          name: "Sapphire Card",
          type: "credit",
          subtype: "credit card",
          current_balance: 1200,
          iso_currency_code: "USD",
          plaid_item_id: "item-1",
          updated_at: "2026-08-25T10:00:00.000Z", // stale (>48h)
        },
      ];

      const items = [{ id: "item-1", institution_name: "Chase" }];

      const transactions = [
        // Checking: deposit (-5000) and grocery charge (200) => sum = -4800 => calculated = 4800
        { account_id: "acc-checking", amount: -5000, date: "2026-08-01" },
        { account_id: "acc-checking", amount: 200, date: "2026-08-15" },
        // Credit card: charges 1000 + 200 => sum = 1200 => calculated = 1200
        { account_id: "acc-card", amount: 1000, date: "2026-08-10" },
        { account_id: "acc-card", amount: 200, date: "2026-08-20" },
      ];

      const rows = buildAccountReconciliationRows({
        accounts,
        items,
        transactions,
        now,
      });

      expect(rows).toHaveLength(2);

      const checking = rows.find((r) => r.accountId === "acc-checking")!;
      expect(checking.accountName).toBe("Primary Checking");
      expect(checking.institutionName).toBe("Chase");
      expect(checking.providerBalance).toBe(5000);
      expect(checking.calculatedLedgerBalance).toBe(4800);
      expect(checking.difference).toBe(200);
      expect(checking.transactionCount).toBe(2);
      expect(checking.coverageStart).toBe("2026-08-01");
      expect(checking.coverageEnd).toBe("2026-08-15");
      expect(checking.isStale).toBe(false);

      const card = rows.find((r) => r.accountId === "acc-card")!;
      expect(card.accountName).toBe("Sapphire Card");
      expect(card.providerBalance).toBe(1200);
      expect(card.calculatedLedgerBalance).toBe(1200);
      expect(card.difference).toBe(0);
      expect(card.transactionCount).toBe(2);
      expect(card.coverageStart).toBe("2026-08-10");
      expect(card.coverageEnd).toBe("2026-08-20");
      expect(card.isStale).toBe(true);
    });
  });

  describe("loadAccountReconciliation", () => {
    it("pages transactions and returns empty array if no accounts", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          then: vi.fn((callback) => {
            if (table === "accounts") return Promise.resolve({ data: [], error: null }).then(callback);
            if (table === "plaid_items") return Promise.resolve({ data: [], error: null }).then(callback);
            return Promise.resolve({ data: [], error: null }).then(callback);
          }),
        })),
      };

      const result = await loadAccountReconciliation(mockSupabase as unknown as never, "user-1");
      expect(result).toEqual([]);
    });
  });
});
