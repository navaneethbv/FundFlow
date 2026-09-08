import { describe, expect, it } from "vitest";
import {
  loadHoldings,
  loadHoldingSnapshots,
  loadInvestmentTransactions,
  loadHoldingAccountOptions,
  loadInvestmentAccounts,
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

  describe("loadInvestmentAccounts", () => {
    it("does not count a stale duplicate Item in the investment total", async () => {
      const identity = {
        type: "investment",
        subtype: "401k",
        iso_currency_code: "USD",
        plaid_items: { institution_name: "Fidelity" },
      };
      const supabase = clientStub({
        accounts: {
          data: [
            { ...identity, id: "ibm-old", plaid_item_id: "old", name: "IBM 401(K) PLAN", mask: "2940", current_balance: 22730.61, updated_at: "2026-07-08T00:00:00Z" },
            { ...identity, id: "paypal-old", plaid_item_id: "old", name: "PAYPAL 401(K) SAVINGS PLAN", mask: "7538", current_balance: 21692.43, updated_at: "2026-07-08T00:00:00Z" },
            { ...identity, id: "ibm-current", plaid_item_id: "current", name: "IBM 401(K) PLAN", mask: "2940", current_balance: 23179.16, updated_at: "2026-09-07T23:30:00Z" },
            { ...identity, id: "paypal-current", plaid_item_id: "current", name: "PAYPAL 401(K) SAVINGS PLAN", mask: "7538", current_balance: 22060.84, updated_at: "2026-09-07T23:30:00Z" },
          ],
        },
        manual_accounts: { data: [] },
      });

      const accounts = await loadInvestmentAccounts(supabase as never, "user-1");

      expect(accounts.map((row) => row.id)).toEqual(["ibm-current", "paypal-current"]);
      expect(accounts.reduce((sum, row) => sum + (row.balance ?? 0), 0)).toBe(45240);
    });

    it("maps the real Plaid and manual account schemas", async () => {
      const supabase = clientStub({
        accounts: {
          data: [
            {
              id: "acc-1",
              name: "Workplace 401k",
              mask: "4321",
              updated_at: "2026-08-01T12:00:00Z",
              plaid_items: { institution_name: "Example Bank" },
              type: "investment",
              subtype: "401k",
              current_balance: "30000.25",
              iso_currency_code: "USD",
            },
            {
              id: "acc-2",
              name: "Checking",
              type: "depository",
              subtype: "checking",
              current_balance: 500,
              iso_currency_code: "USD",
            },
          ],
        },
        manual_accounts: {
          data: [
            {
              id: "manual-1",
              name: "Private investment",
              account_type: "investment",
              balance: "1200.50",
            },
            {
              id: "manual-2",
              name: "Manual cash",
              account_type: "cash",
              balance: 100,
            },
          ],
        },
      });

      const accounts = await loadInvestmentAccounts(supabase as never, "user-1");

      expect(accounts).toEqual([
        {
          id: "manual-1",
          name: "Private investment",
          source: "manual",
          type: "investment",
          subtype: null,
          balance: 1200.5,
          currency: "USD",
        },
        {
          id: "acc-1",
          name: "Workplace 401k ••4321",
          updatedAt: "2026-08-01T12:00:00Z",
          institutionName: "Example Bank",
          source: "plaid",
          type: "investment",
          subtype: "401k",
          balance: 30000.25,
          currency: "USD",
        },
      ]);
      expect(supabase.scopedToUser("accounts", "user-1")).toBe(true);
      expect(supabase.scopedToUser("manual_accounts", "user-1")).toBe(true);
      expect(supabase.callsOn("manual_accounts")).toContainEqual({
        method: "select",
        args: ["id, name, account_type, balance"],
      });
    });
  });
});
