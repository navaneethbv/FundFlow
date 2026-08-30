import { describe, expect, it } from "vitest";
import { clientStub } from "../fixtures/supabase-query";
import { loadCanonicalProjection } from "@/lib/finance-query";
import { fetchPrivacySafeRows } from "@/lib/export";
import { loadCashFlowData } from "@/lib/cash-flow-data";

const TXN_ID = "11111111-1111-4111-8111-111111111111";
const ACCT_ID = "22222222-2222-4222-8222-222222222222";

function seededSupabase() {
  return clientStub({
    accounts: { data: [{ id: ACCT_ID, name: "Checking", iso_currency_code: "USD" }] },
    transactions: {
      data: [
        {
          id: TXN_ID,
          user_id: "user-1",
          account_id: ACCT_ID,
          manual_account_id: null,
          plaid_transaction_id: "plaid-retail",
          date: "2026-08-01",
          amount: 123.45,
          merchant_name: "Example Retailer",
          name: "RETAIL PURCHASE",
          pfc_primary: "TRANSFER_OUT",
          pfc_detailed: "TRANSFER_OUT",
          pending: false,
        },
      ],
    },
    merchant_rules: { data: [] },
    category_overrides: { data: [] },
    linked_refunds: { data: [] },
    linked_duplicates: { data: [] },
    transaction_splits: { data: [] },
    transaction_annotations: {
      data: [
        {
          transaction_id: TXN_ID,
          display_category: "SHOPPING",
          cash_flow_classification: "expense",
        },
      ],
    },
    profiles: { data: [{ ai_export_enabled: true }] },
    sync_jobs: { data: [] },
  });
}

describe("transaction override consistency across canonical surfaces", () => {
  it("applies the override through loadCanonicalProjection (Reports, Budget, Year in Money, widgets)", async () => {
    const supabase = seededSupabase();
    const { transactions } = await loadCanonicalProjection(supabase as never, {
      scope: { kind: "mine", ownerUserId: "user-1" },
    });
    expect(transactions[0]).toMatchObject({
      flow: "expense",
      groupKey: "SHOPPING",
      categoryKey: "SHOPPING",
      signedAmount: 123.45,
    });
  });

  it("applies the override through the cash-flow data path", async () => {
    const supabase = seededSupabase();
    const { transactions } = await loadCashFlowData(supabase as never, {
      scope: { kind: "mine", ownerUserId: "user-1" },
      anchorMonth: "2026-08",
      rangeMonths: 6,
    });
    expect(transactions[0]).toMatchObject({
      flow: "expense",
      groupKey: "SHOPPING",
    });
  });

  it("applies the override through the privacy-safe export path", async () => {
    const supabase = seededSupabase();
    const result = await fetchPrivacySafeRows(supabase as never, "user-1");
    expect(result).toEqual({
      allowed: true,
      rows: [
        { date: "2026-08-01", merchant: "Example Retailer", amount: 123.45, category: "SHOPPING" },
      ],
    });
  });

  it("keeps a non-overridden transfer excluded everywhere", async () => {
    const supabase = clientStub({
      accounts: { data: [{ id: ACCT_ID, name: "Checking", iso_currency_code: "USD" }] },
      transactions: {
        data: [
          {
            id: TXN_ID,
            user_id: "user-1",
            account_id: ACCT_ID,
            manual_account_id: null,
            plaid_transaction_id: "plaid-transfer",
            date: "2026-08-01",
            amount: 500,
            merchant_name: "Transfer",
            name: "TRANSFER",
            pfc_primary: "TRANSFER_OUT",
            pfc_detailed: "TRANSFER_OUT",
            pending: false,
          },
        ],
      },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      linked_refunds: { data: [] },
      linked_duplicates: { data: [] },
      transaction_splits: { data: [] },
      transaction_annotations: { data: [] },
      profiles: { data: [{ ai_export_enabled: true }] },
      sync_jobs: { data: [] },
    });
    const { transactions } = await loadCanonicalProjection(supabase as never, {
      scope: { kind: "mine", ownerUserId: "user-1" },
    });
    expect(transactions[0]).toMatchObject({ flow: "transfer", groupKey: "TRANSFER_OUT" });
  });
});
