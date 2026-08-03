import { describe, expect, it } from "vitest";
import {
  loadHoldings,
  loadHoldingSnapshots,
  loadInvestmentTransactions,
  loadHoldingAccountOptions,
} from "@/lib/investments-data";
import { clientStub } from "../fixtures/supabase-query";

describe("investments-data", () => {
  describe("loadHoldings", () => {
    it("loads joined holdings with account names and fallbacks", async () => {
      const supabase = clientStub({
        holdings: {
          data: [
            {
              id: "h1",
              account_id: "acc-1",
              manual_account_id: null,
              quantity: 10,
              institution_price: 150,
              institution_value: 1500,
              source: "plaid",
              is_active: true,
              securities: {
                name: "Apple Inc.",
                ticker: "AAPL",
                security_type: "equity",
                close_price: 148,
              },
            },
            {
              id: "h2",
              account_id: null,
              manual_account_id: "macc-1",
              quantity: 5,
              institution_price: null,
              institution_value: 500,
              source: "manual",
              is_active: true,
              securities: null,
            },
            {
              id: "h3",
              account_id: "acc-unknown",
              manual_account_id: null,
              quantity: 1,
              institution_price: 100,
              institution_value: 100,
              source: "plaid",
              is_active: false,
              securities: null,
            },
          ],
        },
        accounts: {
          data: [{ id: "acc-1", name: null }],
        },
        manual_accounts: {
          data: [{ id: "macc-1", name: "Crypto Wallet" }],
        },
      });

      const holdings = await loadHoldings(supabase as never);

      expect(holdings).toHaveLength(3);
      expect(holdings[0].accountName).toBe("Account");
      expect(holdings[0].securityName).toBe("Apple Inc.");
      expect(holdings[0].price).toBe(150);
      expect(holdings[1].accountName).toBe("Crypto Wallet");
      expect(holdings[1].securityName).toBe("Unnamed security");
      expect(holdings[2].accountName).toBe("Account");
    });

    it("throws when database query fails", async () => {
      const supabase = clientStub({
        holdings: { error: new Error("Holdings error") },
      });

      await expect(loadHoldings(supabase as never)).rejects.toThrow("Holdings error");
    });

    it("throws when accounts database query fails", async () => {
      const supabase = clientStub({
        holdings: {
          data: [{ id: "h1", account_id: "acc-1", manual_account_id: null }],
        },
        accounts: { error: new Error("Accounts query error") },
        manual_accounts: { data: [] },
      });

      await expect(loadHoldings(supabase as never)).rejects.toThrow("Accounts query error");
    });
  });

  describe("loadHoldingSnapshots", () => {
    it("loads snapshots sorted by snapshot_date", async () => {
      const supabase = clientStub({
        holding_snapshots: {
          data: [
            {
              holding_id: "h1",
              snapshot_date: "2026-07-01",
              quantity: 10,
              price: 140,
              value: 1400,
            },
          ],
        },
      });

      const snapshots = await loadHoldingSnapshots(supabase as never);

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].holdingId).toBe("h1");
      expect(snapshots[0].value).toBe(1400);
    });

    it("throws on query error", async () => {
      const supabase = clientStub({
        holding_snapshots: { error: new Error("Snapshot error") },
      });

      await expect(loadHoldingSnapshots(supabase as never)).rejects.toThrow("Snapshot error");
    });
  });

  describe("loadInvestmentTransactions", () => {
    it("loads active investment transactions", async () => {
      const supabase = clientStub({
        investment_transactions: {
          data: [
            {
              date: "2026-07-05",
              amount: 500,
              txn_subtype: "buy",
            },
          ],
        },
      });

      const txns = await loadInvestmentTransactions(supabase as never);

      expect(txns).toHaveLength(1);
      expect(txns[0].amount).toBe(500);
      expect(txns[0].txnSubtype).toBe("buy");
    });

    it("throws on query error", async () => {
      const supabase = clientStub({
        investment_transactions: { error: new Error("Txn error") },
      });

      await expect(loadInvestmentTransactions(supabase as never)).rejects.toThrow("Txn error");
    });
  });

  describe("loadHoldingAccountOptions", () => {
    it("combines Plaid and manual account options with default names", async () => {
      const supabase = clientStub({
        accounts: {
          data: [{ id: "acc-1", name: null }],
        },
        manual_accounts: {
          data: [{ id: "macc-1", name: "Manual Account" }],
        },
      });

      const options = await loadHoldingAccountOptions(supabase as never, "user-1");

      expect(options).toHaveLength(2);
      expect(options[0]).toEqual({
        id: "acc-1",
        name: "Account",
        source: "plaid",
      });
      expect(options[1]).toEqual({
        id: "macc-1",
        name: "Manual Account",
        source: "manual",
      });
    });

    it("throws when accounts or manual_accounts error", async () => {
      const supabase = clientStub({
        accounts: { error: new Error("Acc err") },
        manual_accounts: { data: [] },
      });

      await expect(loadHoldingAccountOptions(supabase as never, "user-1")).rejects.toThrow("Acc err");
    });
  });
});
