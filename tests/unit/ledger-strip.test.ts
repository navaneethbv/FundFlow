import { describe, it, expect } from "vitest";
import {
  pickAnchorAccount,
  buildLedgerStripTicks,
  loadLedgerStripTicks,
  type LedgerStripAccount,
  type LedgerStripTransaction,
} from "@/lib/ledger-strip";

function account(partial: Partial<LedgerStripAccount> = {}): LedgerStripAccount {
  return {
    id: "acct-1",
    name: "Demo Checking",
    mask: "0001",
    current_balance: 4820.55,
    iso_currency_code: "USD",
    type: "depository",
    ...partial,
  };
}

function transaction(partial: Partial<LedgerStripTransaction> = {}): LedgerStripTransaction {
  return {
    id: "txn-1",
    date: "2026-08-01",
    amount: 10,
    merchant_name: "Corner Grocer",
    name: null,
    ...partial,
  };
}

describe("pickAnchorAccount", () => {
  it("returns the first depository account with a balance", () => {
    const accounts = [
      account({ id: "credit-1", type: "credit", current_balance: -500 }),
      account({ id: "checking-1", type: "depository", current_balance: 1000 }),
    ];
    expect(pickAnchorAccount(accounts)?.id).toBe("checking-1");
  });

  it("returns null for empty array", () => {
    expect(pickAnchorAccount([])).toBeNull();
  });

  it("returns null when no depository account exists", () => {
    const accounts = [account({ type: "credit" }), account({ type: "loan" })];
    expect(pickAnchorAccount(accounts)).toBeNull();
  });

  it("skips a depository account with no balance on record", () => {
    const accounts = [
      account({ id: "checking-1", type: "depository", current_balance: null }),
      account({ id: "checking-2", type: "depository", current_balance: 250 }),
    ];
    expect(pickAnchorAccount(accounts)?.id).toBe("checking-2");
  });
});

describe("buildLedgerStripTicks", () => {
  it("returns an empty array for no transactions", () => {
    expect(buildLedgerStripTicks([], 100)).toEqual([]);
  });

  it("handles zero amount transaction (delta = 0) as minor tick", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: 0 })], 100);
    expect(ticks[0]!.amount).toBe(-0);
    expect(ticks[0]!.major).toBe(false);
  });

  it("ends on the current balance", () => {
    const ticks = buildLedgerStripTicks(
      [
        transaction({ id: "1", date: "2026-08-01", amount: 1650 }),
        transaction({ id: "2", date: "2026-08-16", amount: -2450 }),
      ],
      4820.55,
    );
    expect(ticks[ticks.length - 1]!.runningBalance).toBe(4820.55);
  });

  it("sorts by date then id, oldest first", () => {
    const ticks = buildLedgerStripTicks(
      [
        transaction({ id: "b", date: "2026-08-16", amount: -2450 }),
        transaction({ id: "a", date: "2026-08-01", amount: 1650 }),
      ],
      100,
    );
    expect(ticks.map((tick) => tick.id)).toEqual(["a", "b"]);
  });

  it("converts a positive Plaid amount (money out) to a negative ledger delta", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: 64.18 })], 100);
    expect(ticks[0]!.amount).toBe(-64.18);
  });

  it("converts a negative Plaid amount (money in) to a positive ledger delta", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: -2450 })], 100);
    expect(ticks[0]!.amount).toBe(2450);
  });

  it("marks any inflow as major regardless of size", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: -5 })], 100);
    expect(ticks[0]!.major).toBe(true);
  });

  it("marks an outflow at or above the threshold as major", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: 100 })], 100);
    expect(ticks[0]!.major).toBe(true);
  });

  it("marks a small outflow below the threshold as minor", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: 6.75 })], 100);
    expect(ticks[0]!.major).toBe(false);
  });

  it("falls back to the transaction name when merchant_name is null", () => {
    const ticks = buildLedgerStripTicks(
      [transaction({ merchant_name: null, name: "ACME PAYROLL DEP" })],
      100,
    );
    expect(ticks[0]!.label).toBe("ACME PAYROLL DEP");
  });

  it("falls back to 'Transaction' when both merchant_name and name are null", () => {
    const ticks = buildLedgerStripTicks(
      [transaction({ merchant_name: null, name: null })],
      100,
    );
    expect(ticks[0]!.label).toBe("Transaction");
  });

  it("respects a custom majorThreshold option", () => {
    const ticks = buildLedgerStripTicks(
      [transaction({ amount: 50 })],
      100,
      { majorThreshold: 25 },
    );
    expect(ticks[0]!.major).toBe(true);
  });

  it("sorts deterministically when date and id are identical", () => {
    const ticks = buildLedgerStripTicks(
      [
        transaction({ id: "same", date: "2026-08-01" }),
        transaction({ id: "same", date: "2026-08-01" }),
      ],
      100,
    );
    expect(ticks).toHaveLength(2);
  });
});

describe("loadLedgerStripTicks", () => {
  it("filters returned ticks to only the requested month while calculating running balances across all loaded transactions", async () => {
    const fakeTransactions = [
      { id: "1", date: "2026-06-15", amount: 50, merchant_name: "June Shop", name: null },
      { id: "2", date: "2026-07-10", amount: 20, merchant_name: "July Coffee", name: null },
    ];
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              lte: () => ({
                order: () => ({
                  order: () => Promise.resolve({ data: fakeTransactions, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as never;

    const ticks = await loadLedgerStripTicks(mockSupabase, {
      accountId: "acct-1",
      month: "2026-06",
      today: "2026-07-20",
      currentBalance: 500,
    });

    // Only June tick is returned, but running balance accounts for all transactions
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.id).toBe("1");
    expect(ticks[0]!.date).toBe("2026-06-15");
    expect(ticks[0]!.runningBalance).toBe(520); // 500 - (-50 + -20) + (-50) = 570 - 50 = 520
  });

  it("handles null data from supabase query without throwing", async () => {
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              lte: () => ({
                order: () => ({
                  order: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as never;

    const ticks = await loadLedgerStripTicks(mockSupabase, {
      accountId: "acct-1",
      month: "2026-06",
      today: "2026-07-20",
      currentBalance: 500,
    });

    expect(ticks).toEqual([]);
  });

  it("throws when supabase query errors", async () => {
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              lte: () => ({
                order: () => ({
                  order: () => Promise.resolve({ data: null, error: new Error("DB error") }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as never;

    await expect(
      loadLedgerStripTicks(mockSupabase, {
        accountId: "acct-1",
        month: "2026-06",
        today: "2026-07-20",
        currentBalance: 500,
      }),
    ).rejects.toThrow("DB error");
  });
});

