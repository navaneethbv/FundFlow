import { describe, expect, it } from "vitest";
import { loadForecastPageData } from "@/lib/forecasting-data";
import { clientStub } from "../fixtures/supabase-query";

describe("loadForecastPageData", () => {
  it("loads starting state and defaults for forecast page", async () => {
    const supabase = clientStub({
      accounts: {
        data: [
          { type: "depository", subtype: "checking", current_balance: 10000 },
          { type: "credit", subtype: "credit card", current_balance: 1000 },
        ],
      },
      manual_accounts: {
        data: [{ account_type: "investment", balance: 5000 }],
      },
      transactions: {
        data: [
          {
            id: "t1",
            user_id: "user-1",
            account_id: "acc-1",
            date: "2026-06-01",
            amount: 500,
            pfc_primary: "FOOD_AND_DRINK",
            pending: false,
          },
        ],
      },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    });

    const data = await loadForecastPageData(supabase as never, "user-1", "2026-07-15");

    expect(data.startingState).toBeDefined();
    expect(data.defaults).toBeDefined();
    expect(data.startingState.cash).toBe(10000);
    expect(data.startingState.investments).toBe(5000);
    expect(data.startingState.liabilities).toBe(1000);
  });

  it("throws error if accounts query fails", async () => {
    const supabase = clientStub({
      accounts: { error: new Error("Accounts error") },
      manual_accounts: { data: [] },
      transactions: { data: [] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    });

    await expect(loadForecastPageData(supabase as never, "user-1", "2026-07-15")).rejects.toThrow();
  });

  it("throws error if manual accounts query fails", async () => {
    const supabase = clientStub({
      accounts: { data: [] },
      manual_accounts: { error: new Error("Manual error") },
      transactions: { data: [] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    });

    await expect(loadForecastPageData(supabase as never, "user-1", "2026-07-15")).rejects.toThrow();
  });

  it("handles null balances and empty accounts data", async () => {
    const supabase = clientStub({
      accounts: {
        data: [{ type: "depository", subtype: "checking", current_balance: null }],
      },
      manual_accounts: {
        data: [{ account_type: "investment", balance: null }],
      },
      transactions: { data: [] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    });

    const data = await loadForecastPageData(supabase as never, "user-1", "2026-07-15");
    expect(data.startingState.cash).toBe(0);
    expect(data.startingState.investments).toBe(0);
  });
});
