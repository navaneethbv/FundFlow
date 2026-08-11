import { describe, expect, it } from "vitest";
import { loadCashFlowData } from "@/lib/cash-flow-data";
import { FINANCE_MAX_ROWS } from "@/lib/finance-query";
import type { FinancialScope } from "@/lib/financial-scope";
import { clientStub } from "../fixtures/supabase-query";

const MINE: FinancialScope = { kind: "mine", ownerUserId: "user-1" };
const HOUSEHOLD: FinancialScope = {
  kind: "household",
  householdId: "household-1",
};

const transactionRows = [
  {
    id: "expense-1",
    user_id: "user-1",
    account_id: "account-1",
    plaid_transaction_id: "plaid-expense-1",
    date: "2026-07-10",
    amount: 100,
    merchant_name: "Original Market",
    name: "ORIGINAL MARKET",
    pfc_primary: "FOOD_AND_DRINK",
    pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
    pending: false,
  },
  {
    id: "charge-1",
    user_id: "user-1",
    account_id: "account-1",
    plaid_transaction_id: "plaid-charge-1",
    date: "2026-07-11",
    amount: 25,
    merchant_name: "Returned Store",
    name: "RETURNED STORE",
    pfc_primary: "GENERAL_MERCHANDISE",
    pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
    pending: false,
  },
  {
    id: "refund-1",
    user_id: "user-1",
    account_id: "account-1",
    plaid_transaction_id: "plaid-refund-1",
    date: "2026-07-12",
    amount: -25,
    merchant_name: "Returned Store",
    name: "RETURNED STORE",
    pfc_primary: "GENERAL_MERCHANDISE",
    pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
    pending: false,
  },
];

function makeClient() {
  return clientStub({
    transactions: { data: transactionRows },
    accounts: {
      data: [
        {
          id: "account-1",
          user_id: "user-1",
          name: "Checking",
          iso_currency_code: "usd",
        },
      ],
    },
    merchant_rules: {
      data: [
        {
          match_type: "merchant",
          pattern: "Original Market",
          display_name: "Neighborhood Market",
          category: "FOOD_AND_DRINK",
          enabled: true,
        },
      ],
    },
    category_overrides: {
      data: [
        {
          source_category: "FOOD_AND_DRINK",
          display_category: "EVERYDAY",
        },
      ],
    },
    transaction_splits: {
      data: [
        {
          transaction_id: "expense-1",
          category: "Groceries",
          amount: 40,
        },
        {
          transaction_id: "expense-1",
          category: "Dining",
          amount: 60,
        },
      ],
    },
    linked_refunds: {
      data: [
        {
          charge_transaction_id: "charge-1",
          refund_transaction_id: "refund-1",
        },
      ],
    },
    sync_jobs: {
      data: { updated_at: "2026-07-29T10:00:00.000Z" },
    },
  });
}

describe("loadCashFlowData", () => {
  it("loads a bounded Mine window and all canonical projection dependencies", async () => {
    const supabase = makeClient();
    const result = await loadCashFlowData(supabase as never, {
      scope: MINE,
      anchorMonth: "2026-07",
      rangeMonths: 12,
      now: new Date("2026-07-29T12:00:00.000Z"),
    });

    expect(supabase.callsOn("transactions")).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["user_id", "user-1"] },
        { method: "gte", args: ["date", "2025-08-01"] },
        { method: "lt", args: ["date", "2026-08-01"] },
        { method: "range", args: [0, 999] },
      ]),
    );
    for (const table of [
      "accounts",
      "merchant_rules",
      "category_overrides",
      "transaction_splits",
      "linked_refunds",
      "sync_jobs",
    ]) {
      expect(supabase.scopedToUser(table, "user-1")).toBe(true);
    }
    expect(supabase.callsOn("transaction_splits")).toContainEqual({
      method: "in",
      args: [
        "transaction_id",
        ["expense-1", "charge-1", "refund-1"],
      ],
    });
    expect(FINANCE_MAX_ROWS).toBe(25_000);

    expect(result.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "expense-1::0",
          merchant: "Neighborhood Market",
          groupKey: "EVERYDAY",
          categoryKey: "Groceries",
          signedAmount: 40,
          flow: "expense",
        }),
        expect.objectContaining({
          id: "expense-1::1",
          categoryKey: "Dining",
          signedAmount: 60,
        }),
        expect.objectContaining({ id: "charge-1", flow: "transfer" }),
        expect.objectContaining({ id: "refund-1", flow: "transfer" }),
      ]),
    );
    expect(result.currencyByAccountId).toEqual(
      new Map([["account-1", "USD"]]),
    );
    expect(result.truncated).toBe(false);
    expect(result.lastSuccessfulSyncAt).toBe("2026-07-29T10:00:00.000Z");
    expect(result.stale).toBe(false);
  });

  it("leaves Household dependency visibility to the cookie client's RLS", async () => {
    const supabase = makeClient();
    await loadCashFlowData(supabase as never, {
      scope: HOUSEHOLD,
      anchorMonth: "2026-07",
      rangeMonths: 6,
      now: new Date("2026-07-29T12:00:00.000Z"),
    });

    for (const table of [
      "transactions",
      "accounts",
      "merchant_rules",
      "category_overrides",
      "transaction_splits",
      "linked_refunds",
      "sync_jobs",
    ]) {
      expect(supabase.scopedToUser(table, "user-1")).toBe(false);
    }
    expect(supabase.callsOn("transactions")).toEqual(
      expect.arrayContaining([
        { method: "gte", args: ["date", "2026-02-01"] },
        { method: "lt", args: ["date", "2026-08-01"] },
      ]),
    );
  });

  it("reports missing or old successful sync metadata as stale", async () => {
    const missingResult = await loadCashFlowData(
      clientStub({
        transactions: { data: [] },
        accounts: { data: [] },
        merchant_rules: { data: [] },
        category_overrides: { data: [] },
        linked_refunds: { data: [] },
        sync_jobs: { data: null },
      }) as never,
      {
        scope: MINE,
        anchorMonth: "2026-07",
        rangeMonths: 6,
        now: new Date("2026-07-29T12:00:00.000Z"),
      },
    );
    const oldResult = await loadCashFlowData(
      clientStub({
        transactions: { data: [] },
        accounts: { data: [] },
        merchant_rules: { data: [] },
        category_overrides: { data: [] },
        linked_refunds: { data: [] },
        sync_jobs: { data: { updated_at: "2026-07-20T12:00:00.000Z" } },
      }) as never,
      {
        scope: MINE,
        anchorMonth: "2026-07",
        rangeMonths: 6,
        now: new Date("2026-07-29T12:00:00.000Z"),
      },
    );

    expect(missingResult.stale).toBe(true);
    expect(oldResult.stale).toBe(true);
  });

  it("throws error when query fails without a code property", async () => {
    const supabase = clientStub({
      transactions: { data: [] },
      accounts: { data: null, error: { message: "Query failed" } },
    });

    await expect(
      loadCashFlowData(supabase as never, {
        scope: MINE,
        anchorMonth: "2026-07",
        rangeMonths: 6,
      }),
    ).rejects.toThrow("cash_flow_query_failed:accounts");
  });

  it("formats a query failure code when present", async () => {
    const supabase = clientStub({
      transactions: { data: [] },
      accounts: { data: null, error: { code: "PGRST116" } },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      linked_refunds: { data: [] },
      sync_jobs: { data: null },
    });

    await expect(
      loadCashFlowData(supabase as never, {
        scope: MINE,
        anchorMonth: "2026-07",
        rangeMonths: 6,
      }),
    ).rejects.toThrow("cash_flow_query_failed:accounts:PGRST116");
  });

  it("treats unparseable sync metadata as stale and defaults a missing name and currency", async () => {
    const supabase = clientStub({
      transactions: { data: [] },
      accounts: {
        data: [{ id: "account-1", name: null, iso_currency_code: null }],
      },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
      sync_jobs: { data: { updated_at: "not-a-date" } },
    });

    const result = await loadCashFlowData(supabase as never, {
      scope: MINE,
      anchorMonth: "2026-07",
      rangeMonths: 6,
    });

    expect(result.stale).toBe(true);
    expect(result.currencyByAccountId.get("account-1")).toBe("");
  });

  it("handles null payloads from every dependency table", async () => {
    const supabase = clientStub({
      transactions: { data: transactionRows },
      accounts: { data: null },
      merchant_rules: { data: null },
      category_overrides: { data: null },
      transaction_splits: { data: null },
      linked_refunds: { data: null },
      sync_jobs: { data: null },
    });

    const result = await loadCashFlowData(supabase as never, {
      scope: MINE,
      anchorMonth: "2026-07",
      rangeMonths: 6,
      now: new Date("2026-07-29T12:00:00.000Z"),
    });

    expect(result.transactions).toHaveLength(3);
  });

  it("excludes duplicate-linked transactions and defaults the reference now", async () => {
    const supabase = clientStub({
      transactions: { data: transactionRows },
      accounts: { data: null },
      merchant_rules: { data: null },
      category_overrides: { data: null },
      transaction_splits: { data: null },
      linked_refunds: { data: null },
      linked_duplicates: {
        data: [{ excluded_transaction_id: "charge-1" }],
      },
      sync_jobs: { data: null },
    });

    const result = await loadCashFlowData(supabase as never, {
      scope: MINE,
      anchorMonth: "2026-07",
      rangeMonths: 6,
    });

    expect(result.transactions.some((t) => t.id === "charge-1")).toBe(false);
  });
});
