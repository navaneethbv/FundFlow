import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvestmentsHoldingsGet = vi.fn();
const mockInvestmentsTransactionsGet = vi.fn().mockResolvedValue({
  data: { investment_transactions: [], total_investment_transactions: 0 },
});
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    investmentsHoldingsGet: (...args: unknown[]) => mockInvestmentsHoldingsGet(...args),
    investmentsTransactionsGet: (...args: unknown[]) => mockInvestmentsTransactionsGet(...args),
  }),
}));

const mockServiceClient = { from: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockDecryptItemTokenAndUpgrade = vi.fn().mockResolvedValue("access-token-123");
const mockListActiveItems = vi.fn();
vi.mock("@/lib/plaid-service", () => ({
  decryptItemTokenAndUpgrade: (...args: unknown[]) => mockDecryptItemTokenAndUpgrade(...args),
  listActiveItems: (...args: unknown[]) => mockListActiveItems(...args),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({ logError: (...args: unknown[]) => mockLogError(...args) }));

import {
  syncInvestmentsForItem,
  syncInvestmentsForUser,
  syncInvestmentTransactionsForItem,
  RETRIABLE_INVESTMENT_OUTCOMES,
} from "@/lib/investment-sync";
import type { PlaidItemRow } from "@/lib/types";

const item: PlaidItemRow = {
  id: "item-db-1",
  user_id: "user-1",
  plaid_item_id: "plaid-item-1",
  institution_id: "inst-1",
  institution_name: "Fidelity",
  access_token_ciphertext: "cipher",
  access_token_iv: "iv",
  access_token_tag: "tag",
  sync_cursor: null,
  status: "active",
  error_code: null,
};

function tableStub(overrides: Record<string, unknown> = {}) {
  const accountsSelectEq = vi.fn().mockResolvedValue({
    data: [{ id: "db-acc-1", plaid_account_id: "plaid-acc-1" }],
    error: null,
  });
  const accountsSelect = vi.fn().mockReturnValue({ eq: accountsSelectEq });

  const securitiesUpsertSelect = vi.fn().mockResolvedValue({
    data: [{ id: "sec-db-1", plaid_security_id: "sec-plaid-1" }],
    error: null,
  });
  const securitiesUpsert = vi.fn().mockReturnValue({ select: securitiesUpsertSelect });

  const holdingsUpsertSelect = vi.fn().mockResolvedValue({
    data: [{ id: "holding-db-1" }],
    error: null,
  });
  const holdingsUpsert = vi.fn().mockReturnValue({ select: holdingsUpsertSelect });
  const holdingsSelectEqEq = vi.fn().mockResolvedValue({ data: [{ id: "holding-db-1" }], error: null });
  const holdingsSelectEq1 = vi.fn().mockReturnValue({ eq: holdingsSelectEqEq });
  const holdingsSelectIn = vi.fn().mockReturnValue({ eq: holdingsSelectEq1 });
  const holdingsSelect = vi.fn().mockReturnValue({ in: holdingsSelectIn });
  const holdingsUpdateIn = vi.fn().mockResolvedValue({ error: null });
  const holdingsUpdate = vi.fn().mockReturnValue({ in: holdingsUpdateIn });

  const snapshotsUpsert = vi.fn().mockResolvedValue({ error: null });

  const syncJobsInsert = vi.fn().mockResolvedValue({ error: null });

  const defaults: Record<string, unknown> = {
    accounts: { select: accountsSelect },
    securities: { upsert: securitiesUpsert },
    holdings: { upsert: holdingsUpsert, select: holdingsSelect, update: holdingsUpdate },
    holding_snapshots: { upsert: snapshotsUpsert },
    sync_jobs: { insert: syncJobsInsert },
  };
  const tables = { ...defaults, ...overrides };
  return {
    tables,
    spies: {
      accountsSelect,
      securitiesUpsert,
      holdingsUpsert,
      holdingsUpdate,
      holdingsUpdateIn,
      snapshotsUpsert,
      syncJobsInsert,
    },
  };
}

describe("syncInvestmentsForItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts securities and holdings, snapshots values, and reports outcome=synced", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: {
        accounts: [{ account_id: "plaid-acc-1" }],
        holdings: [
          {
            account_id: "plaid-acc-1",
            security_id: "sec-plaid-1",
            quantity: 10,
            cost_basis: 900,
            institution_price: 100,
            institution_value: 1000,
            institution_price_as_of: "2026-07-30",
          },
        ],
        securities: [
          {
            security_id: "sec-plaid-1",
            ticker_symbol: "VTI",
            name: "Vanguard Total Stock",
            type: "etf",
            subtype: "etf",
            close_price: 99,
            close_price_as_of: "2026-07-29",
            iso_currency_code: "USD",
          },
        ],
      },
    });
    const { tables, spies } = tableStub();
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    const result = await syncInvestmentsForItem(item);

    expect(result).toEqual({ outcome: "synced", holdingsSynced: 1 });
    expect(spies.securitiesUpsert).toHaveBeenCalledWith(
      [expect.objectContaining({ plaid_security_id: "sec-plaid-1", name: "Vanguard Total Stock" })],
      { onConflict: "plaid_security_id" },
    );
    expect(spies.holdingsUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          account_id: "db-acc-1",
          security_id: "sec-db-1",
          source: "plaid",
          is_active: true,
        }),
      ],
      { onConflict: "account_id,security_id" },
    );
    expect(spies.snapshotsUpsert).toHaveBeenCalled();
    // Nothing stale to deactivate — the one existing holding matches the sync.
    expect(spies.holdingsUpdate).not.toHaveBeenCalled();
  });

  it("deactivates a holding absent from a successful full response", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: { accounts: [{ account_id: "plaid-acc-1" }], holdings: [], securities: [] },
    });
    const holdingsUpdateIn = vi.fn().mockResolvedValue({ error: null });
    const holdingsUpdate = vi.fn().mockReturnValue({ in: holdingsUpdateIn });
    const { tables } = tableStub({
      holdings: {
        upsert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [{ id: "stale-holding" }], error: null }),
            }),
          }),
        }),
        update: holdingsUpdate,
      },
    });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    const result = await syncInvestmentsForItem(item);

    expect(result).toEqual({ outcome: "synced", holdingsSynced: 0 });
    expect(holdingsUpdate).toHaveBeenCalledWith({ is_active: false });
    expect(holdingsUpdateIn).toHaveBeenCalledWith("id", ["stale-holding"]);
  });

  it("reports product_not_ready distinctly without throwing", async () => {
    mockInvestmentsHoldingsGet.mockRejectedValueOnce({
      response: { data: { error_code: "PRODUCT_NOT_READY" } },
    });
    const result = await syncInvestmentsForItem(item);
    expect(result).toEqual({ outcome: "product_not_ready", holdingsSynced: 0 });
    expect(RETRIABLE_INVESTMENT_OUTCOMES).toContain("product_not_ready");
  });

  it("reports a missing Investments product distinctly without throwing", async () => {
    mockInvestmentsHoldingsGet.mockRejectedValueOnce({
      response: { data: { error_code: "ADDITIONAL_CONSENT_REQUIRED" } },
    });
    const result = await syncInvestmentsForItem(item);
    expect(result.outcome).toBe("no_investment_product");
    expect(RETRIABLE_INVESTMENT_OUTCOMES).not.toContain("no_investment_product");
  });

  it("reports rate limiting as retriable without throwing", async () => {
    mockInvestmentsHoldingsGet.mockRejectedValueOnce({
      response: { data: { error_code: "RATE_LIMIT_EXCEEDED" } },
    });
    const result = await syncInvestmentsForItem(item);
    expect(result).toEqual({ outcome: "rate_limited", holdingsSynced: 0 });
  });

  it("rethrows an unrecognized Plaid error so the caller can record a real failure", async () => {
    mockInvestmentsHoldingsGet.mockRejectedValueOnce({
      response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } },
    });
    await expect(syncInvestmentsForItem(item)).rejects.toBeTruthy();
  });
});

describe("syncInvestmentsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isolates a per-item failure so the rest of the user's items still sync", async () => {
    mockListActiveItems.mockResolvedValueOnce([
      item,
      { ...item, id: "item-db-2", plaid_item_id: "plaid-item-2" },
    ]);
    mockInvestmentsHoldingsGet
      .mockRejectedValueOnce({ response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } } })
      .mockResolvedValueOnce({
        data: { accounts: [{ account_id: "plaid-acc-1" }], holdings: [], securities: [] },
      });
    const { tables } = tableStub();
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    const total = await syncInvestmentsForUser("user-1");

    expect(total).toBe(0); // second item had no holdings; first item's failure isolated
    expect(mockLogError).toHaveBeenCalled();
  });

  it("records the outcome as an investments-typed sync_jobs row", async () => {
    mockListActiveItems.mockResolvedValueOnce([item]);
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: { accounts: [{ account_id: "plaid-acc-1" }], holdings: [], securities: [] },
    });
    const { tables, spies } = tableStub();
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    await syncInvestmentsForUser("user-1");

    expect(spies.syncJobsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", job_type: "investments" }),
    );
  });
});

describe("syncInvestmentTransactionsForItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvestmentsTransactionsGet.mockReset();
  });

  it("returns synced with 0 when there is nothing in range, without touching the database", async () => {
    mockInvestmentsTransactionsGet.mockResolvedValueOnce({
      data: { investment_transactions: [], total_investment_transactions: 0 },
    });
    const result = await syncInvestmentTransactionsForItem(item, "2026-07-30");
    expect(result).toEqual({ outcome: "synced", transactionsSynced: 0 });
    expect(mockServiceClient.from).not.toHaveBeenCalled();
  });

  it("paginates until every transaction in range is fetched, then upserts idempotently", async () => {
    const txn = (id: string) => ({
      investment_transaction_id: id,
      account_id: "plaid-acc-1",
      security_id: "sec-plaid-1",
      date: "2026-07-15",
      name: "Buy VTI",
      amount: 100,
      quantity: 1,
      price: 100,
      fees: 0,
      type: "buy",
      subtype: "buy",
      iso_currency_code: "USD",
    });
    mockInvestmentsTransactionsGet
      .mockResolvedValueOnce({
        data: { investment_transactions: [txn("t1")], total_investment_transactions: 2 },
      })
      .mockResolvedValueOnce({
        data: { investment_transactions: [txn("t2")], total_investment_transactions: 2 },
      });

    const accountsSelectEq = vi.fn().mockResolvedValue({
      data: [{ id: "db-acc-1", plaid_account_id: "plaid-acc-1" }],
      error: null,
    });
    const securitiesSelectIn = vi.fn().mockResolvedValue({
      data: [{ id: "sec-db-1", plaid_security_id: "sec-plaid-1" }],
      error: null,
    });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "accounts") return { select: () => ({ eq: accountsSelectEq }) };
      if (table === "securities") return { select: () => ({ in: securitiesSelectIn }) };
      if (table === "investment_transactions") return { upsert, update: vi.fn() };
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await syncInvestmentTransactionsForItem(item, "2026-07-30");

    expect(mockInvestmentsTransactionsGet).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ outcome: "synced", transactionsSynced: 2 });
    expect(upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ plaid_investment_transaction_id: "t1", account_id: "db-acc-1", security_id: "sec-db-1" }),
      ]),
      { onConflict: "plaid_investment_transaction_id" },
    );
  });

  it("deactivates the original transaction a cancellation row references", async () => {
    mockInvestmentsTransactionsGet.mockResolvedValueOnce({
      data: {
        investment_transactions: [
          {
            investment_transaction_id: "t-cancel",
            cancel_transaction_id: "t1",
            account_id: "plaid-acc-1",
            security_id: null,
            date: "2026-07-16",
            name: "Cancel buy",
            amount: -100,
            quantity: -1,
            price: 100,
            fees: 0,
            type: "cancel",
            subtype: "cancel",
            iso_currency_code: "USD",
          },
        ],
        total_investment_transactions: 1,
      },
    });
    const accountsSelectEq = vi.fn().mockResolvedValue({
      data: [{ id: "db-acc-1", plaid_account_id: "plaid-acc-1" }],
      error: null,
    });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const updateIn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ in: updateIn });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "accounts") return { select: () => ({ eq: accountsSelectEq }) };
      if (table === "securities") return { select: () => ({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
      if (table === "investment_transactions") return { upsert, update };
      throw new Error(`Unexpected table ${table}`);
    });

    await syncInvestmentTransactionsForItem(item, "2026-07-30");

    expect(update).toHaveBeenCalledWith({ is_active: false });
    expect(updateIn).toHaveBeenCalledWith("plaid_investment_transaction_id", ["t1"]);
  });

  it("reports product_not_ready distinctly without throwing", async () => {
    mockInvestmentsTransactionsGet.mockRejectedValueOnce({
      response: { data: { error_code: "PRODUCT_NOT_READY" } },
    });
    const result = await syncInvestmentTransactionsForItem(item, "2026-07-30");
    expect(result).toEqual({ outcome: "product_not_ready", transactionsSynced: 0 });
  });
});
