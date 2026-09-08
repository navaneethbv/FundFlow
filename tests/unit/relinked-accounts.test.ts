import { describe, expect, it } from "vitest";
import { dedupeRelinkedAccounts } from "@/lib/relinked-accounts";

interface AccountRow {
  id: string;
  plaid_item_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  iso_currency_code: string | null;
  updated_at: string | null;
  current_balance: number;
}

const account = (overrides: Partial<AccountRow>): AccountRow => ({
  id: "account-1",
  plaid_item_id: "item-1",
  name: "IBM 401(K) PLAN",
  mask: "2940",
  type: "investment",
  subtype: "401k",
  iso_currency_code: "USD",
  updated_at: "2026-07-08T00:00:00.000Z",
  current_balance: 22_730.61,
  ...overrides,
});

describe("dedupeRelinkedAccounts", () => {
  it("keeps only the uniquely freshest Item when two complete account sets match", () => {
    const rows = [
      account({ id: "ibm-old", plaid_item_id: "item-old" }),
      account({
        id: "paypal-old",
        plaid_item_id: "item-old",
        name: "PAYPAL 401(K) SAVINGS PLAN",
        mask: "7538",
        current_balance: 21_692.43,
      }),
      account({
        id: "ibm-current",
        plaid_item_id: "item-current",
        updated_at: "2026-09-07T23:30:00.000Z",
        current_balance: 23_179.16,
      }),
      account({
        id: "paypal-current",
        plaid_item_id: "item-current",
        name: "PAYPAL 401(K) SAVINGS PLAN",
        mask: "7538",
        updated_at: "2026-09-07T23:30:00.000Z",
        current_balance: 22_060.84,
      }),
    ];

    const result = dedupeRelinkedAccounts(rows);

    expect(result.map((row) => row.id)).toEqual(["ibm-current", "paypal-current"]);
    expect(result.reduce((sum, row) => sum + row.current_balance, 0)).toBe(45_240);
  });

  it("does not collapse Items when only part of their account sets match", () => {
    const rows = [
      account({ id: "shared-old", plaid_item_id: "item-old" }),
      account({
        id: "old-savings",
        plaid_item_id: "item-old",
        name: "Savings",
        mask: "1111",
      }),
      account({
        id: "shared-new",
        plaid_item_id: "item-new",
        updated_at: "2026-09-07T23:30:00.000Z",
      }),
      account({
        id: "new-savings",
        plaid_item_id: "item-new",
        name: "Savings",
        mask: "2222",
        updated_at: "2026-09-07T23:30:00.000Z",
      }),
    ];

    expect(dedupeRelinkedAccounts(rows)).toEqual(rows);
  });

  it("does not guess when identity fields are missing or freshness is tied", () => {
    const missingMask = [
      account({ id: "missing-1", plaid_item_id: "item-1", mask: null }),
      account({ id: "missing-2", plaid_item_id: "item-2", mask: null }),
    ];
    const tied = [
      account({ id: "tied-1", plaid_item_id: "item-1" }),
      account({ id: "tied-2", plaid_item_id: "item-2" }),
    ];

    expect(dedupeRelinkedAccounts(missingMask)).toEqual(missingMask);
    expect(dedupeRelinkedAccounts(tied)).toEqual(tied);
  });
});
