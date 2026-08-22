import { describe, expect, it, afterEach } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

import { detectCardDesign } from "@/lib/card-design";
import { encryptSecret } from "@/lib/crypto";
import { convertCurrency } from "@/lib/currency";
import { loadBudgetData } from "@/lib/budget-data";

describe("detectCardDesign name-fallback branches", () => {
  it("falls back to Checking Account when a depository has no name", () => {
    const style = detectCardDesign(null, "Checking Account", "depository", "checking");
    expect(style.displayName).toBe("Checking Account");
  });

  it("falls back to Visa Credit when a generic visa has no name", () => {
    const style = detectCardDesign(null, "Generic Visa", "credit", "credit card");
    expect(style.network).toBe("visa");
    expect(style.displayName).toBe("Visa Credit");
  });

  it("falls back to Mastercard Credit when a generic mastercard has no name", () => {
    const style = detectCardDesign(null, "Generic MC", "credit", "credit card");
    expect(style.network).toBe("mastercard");
    expect(style.displayName).toBe("Mastercard Credit");
  });
});

describe("crypto missing key branch", () => {
  const ORIGINAL = process.env.PLAID_TOKEN_ENC_KEY;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PLAID_TOKEN_ENC_KEY;
    else process.env.PLAID_TOKEN_ENC_KEY = ORIGINAL;
  });

  it("throws a clear error when the encryption key is unset", () => {
    delete process.env.PLAID_TOKEN_ENC_KEY;
    expect(() => encryptSecret("secret")).toThrow("Missing PLAID_TOKEN_ENC_KEY");
  });
});

describe("convertCurrency default-rate fallback branches", () => {
  it("falls back to 1.0 for unknown from and to rates", () => {
    expect(convertCurrency(100, "ABC", "DEF", {})).toBe(100);
  });

  it("falls back to 1.0 independently for a missing from rate", () => {
    expect(convertCurrency(100, "ABC", "USD", { USD: 2 })).toBe(200);
  });

  it("falls back to 1.0 independently for a missing to rate", () => {
    expect(convertCurrency(100, "USD", "ABC", { USD: 2 })).toBe(50);
  });
});

describe("loadBudgetData reachable paths", () => {
  it("loads a monthly budget with a selected currency", async () => {
    const db = clientStub({
      households: { data: [{ id: "household-1" }] },
      budgets: { data: [{ id: "b1", category: "Food", monthly_limit: 500, group_name: "flexible", rollover_enabled: false, sort_order: 0 }] },
      budget_periods: { data: [{ budget_id: "b1", month: "2026-07", planned: 300 }] },
      sinking_funds: { data: [] },
      recurring_streams: { data: [] },
      sync_jobs: { data: null },
      transactions: {
        data: [
          {
            id: "t1",
            user_id: "user-1",
            account_id: "acc1",
            date: "2026-06-15",
            amount: 80,
            pfc_primary: "FOOD_AND_DRINK",
            pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
            pending: false,
          },
        ],
      },
      accounts: { data: [{ id: "acc1", name: "Checking", iso_currency_code: "usd" }] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
      goals: { data: [] },
      goal_progress_events: { data: [] },
    }) as never;

    const data = await loadBudgetData(db, {
      userId: "user-1",
      anchorMonth: "2026-07",
      horizon: "monthly",
    });

    expect(data.selectedCurrency).toBe("USD");
    expect(data.view).toBeDefined();
  });

  it("returns a null selected currency when no transactions exist", async () => {
    const db = clientStub({
      households: { data: [{ id: "household-1" }] },
      budgets: { data: [] },
      budget_periods: { data: [] },
      sinking_funds: { data: [] },
      recurring_streams: { data: [] },
      sync_jobs: { data: null },
      transactions: { data: [] },
      accounts: { data: [] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
      goals: { data: [] },
      goal_progress_events: { data: [] },
    }) as never;

    const data = await loadBudgetData(db, {
      userId: "user-1",
      anchorMonth: "2026-07",
      horizon: "monthly",
    });

    expect(data.selectedCurrency).toBeNull();
  });
});
