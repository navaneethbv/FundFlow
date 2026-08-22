import { describe, expect, it } from "vitest";
import { clientStub } from "../fixtures/supabase-query";
import { loadCanonicalProjection } from "@/lib/finance-query";
import { formatDay, formatMonth } from "@/lib/format";
import { FEATURE_FLAG_ENV, isFeatureEnabled, resolveFeatureFlags } from "@/lib/feature-flags";

const MINE = { kind: "mine", ownerUserId: "user-1" } as const;

function projectionClient(overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
  return clientStub({
    transactions: {
      data: [
        {
          id: "expense-1",
          user_id: "user-1",
          account_id: "account-1",
          plaid_transaction_id: "plaid-expense-1",
          date: "2026-07-10",
          amount: 100,
          merchant_name: "Market",
          name: "MARKET",
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
          pending: false,
        },
      ],
    },
    accounts: { data: [{ id: "account-1", name: "Checking", iso_currency_code: "usd" }] },
    merchant_rules: { data: [] },
    category_overrides: { data: [] },
    transaction_splits: { data: [] },
    linked_refunds: { data: [] },
    linked_duplicates: { data: [] },
    ...overrides,
  });
}

describe("loadCanonicalProjection error handling", () => {
  it("maps a transaction query error with a code onto the wrapped suffix", async () => {
    const supabase = projectionClient({
      transactions: { error: { code: "42P01", message: "undocumented detail" } },
    });
    await expect(
      loadCanonicalProjection(supabase as never, { scope: MINE }),
    ).rejects.toThrow("finance_projection_query_failed:transactions:42P01");
  });

  it("keeps no suffix for a non-object transaction error", async () => {
    const supabase = projectionClient({ transactions: { error: "boom" } });
    await expect(
      loadCanonicalProjection(supabase as never, { scope: MINE }),
    ).rejects.toThrow("finance_projection_query_failed:transactions");
  });

  it("keeps no suffix when the error has no code property", async () => {
    const supabase = projectionClient({ transactions: { error: { message: "x" } } });
    await expect(
      loadCanonicalProjection(supabase as never, { scope: MINE }),
    ).rejects.toThrow("finance_projection_query_failed:transactions");
  });

  it("keeps no suffix when the error code is not a string", async () => {
    const supabase = projectionClient({ transactions: { error: { code: 123 } } });
    await expect(
      loadCanonicalProjection(supabase as never, { scope: MINE }),
    ).rejects.toThrow("finance_projection_query_failed:transactions");
  });
});

describe("loadCanonicalProjection linked refunds mapping", () => {
  it("maps a linked refund row end to end", async () => {
    const supabase = projectionClient({
      linked_refunds: {
        data: [{ charge_transaction_id: "charge-1", refund_transaction_id: "refund-1" }],
      },
    });
    const result = await loadCanonicalProjection(supabase as never, { scope: MINE });
    expect(result.transactions).toBeDefined();
    expect(supabase.callsOn("linked_refunds")).toContainEqual({
      method: "order",
      args: ["charge_transaction_id"],
    });
  });
});

describe("formatDay nullish segment branches", () => {
  it("fills missing month and day from a bare year", () => {
    expect(formatDay("2026")).toBe("Jan 1");
    expect(formatDay("2026-05")).toBe("May 1");
  });
});

describe("formatMonth nullish month branch", () => {
  it("fills a missing month from a bare year", () => {
    expect(formatMonth("2026")).toBe("Jan 2026");
  });
});

describe("feature flags force-on/off branches", () => {
  it("forces a flag off and lets force-on leave the default on", () => {
    expect(isFeatureEnabled("reportsPage", { [FEATURE_FLAG_ENV]: "-reportsPage" })).toBe(false);
    expect(isFeatureEnabled("reportsPage", { [FEATURE_FLAG_ENV]: "reportsPage" })).toBe(true);
    expect(resolveFeatureFlags({ [FEATURE_FLAG_ENV]: "-reportsPage,goalsV2" }).goalsV2).toBe(true);
  });
});
