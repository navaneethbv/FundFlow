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
      { onConflict: "account_id,security_id,source" },
    );
    expect(spies.snapshotsUpsert).toHaveBeenCalled();
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

  it("returns no_investment_product when Plaid reports no accounts", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: { accounts: [], holdings: [], securities: [] },
    });
    const { tables } = tableStub();
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    const result = await syncInvestmentsForItem(item);
    expect(result).toEqual({ outcome: "no_investment_product", holdingsSynced: 0 });
  });

  it("returns no_investment_product when the item has no stored accounts", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: { accounts: [{ account_id: "plaid-acc-1" }], holdings: [], securities: [] },
    });
    const accountsSelectEq = vi.fn().mockResolvedValue({ data: null, error: null });
    const accountsSelect = vi.fn().mockReturnValue({ eq: accountsSelectEq });
    const { tables } = tableStub({ accounts: { select: accountsSelect } });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    const result = await syncInvestmentsForItem(item);
    expect(result).toEqual({ outcome: "no_investment_product", holdingsSynced: 0 });
  });

  it("throws when the item account lookup fails", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: { accounts: [{ account_id: "plaid-acc-1" }], holdings: [], securities: [] },
    });
    const accountsSelectEq = vi.fn().mockResolvedValue({ data: null, error: new Error("Accounts error") });
    const accountsSelect = vi.fn().mockReturnValue({ eq: accountsSelectEq });
    const { tables } = tableStub({ accounts: { select: accountsSelect } });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    await expect(syncInvestmentsForItem(item)).rejects.toThrow("Accounts error");
  });

  it("throws when the securities upsert fails", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: {
        accounts: [{ account_id: "plaid-acc-1" }],
        holdings: [],
        securities: [{ security_id: "sec-a" }],
      },
    });
    const securitiesUpsertSelect = vi.fn().mockResolvedValue({ data: null, error: new Error("Securities error") });
    const securitiesUpsert = vi.fn().mockReturnValue({ select: securitiesUpsertSelect });
    const { tables } = tableStub({ securities: { upsert: securitiesUpsert } });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    await expect(syncInvestmentsForItem(item)).rejects.toThrow("Securities error");
  });

  it("maps missing security fields to nulls and defaults", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: {
        accounts: [{ account_id: "plaid-acc-1" }],
        holdings: [],
        securities: [
          { security_id: "sec-a" },
          { security_id: "sec-b", ticker_symbol: "ABC" },
        ],
      },
    });
    const securitiesUpsertSelect = vi.fn().mockResolvedValue({
      data: [
        { id: "db-a", plaid_security_id: "sec-a" },
        { id: "db-b", plaid_security_id: "sec-b" },
      ],
      error: null,
    });
    const securitiesUpsert = vi.fn().mockReturnValue({ select: securitiesUpsertSelect });
    const { tables } = tableStub({ securities: { upsert: securitiesUpsert } });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    await syncInvestmentsForItem(item);

    expect(securitiesUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          ticker: null,
          name: "Unnamed security",
          security_type: null,
          security_subtype: null,
          close_price: null,
          close_price_as_of: null,
          iso_currency_code: null,
        }),
        expect.objectContaining({ ticker: "ABC", name: "ABC" }),
      ],
      { onConflict: "plaid_security_id" },
    );
  });

  it("tolerates a securities upsert returning no rows", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: {
        accounts: [{ account_id: "plaid-acc-1" }],
        holdings: [{ account_id: "plaid-acc-1", security_id: "sec-plaid-1" }],
        securities: [{ security_id: "sec-plaid-1" }],
      },
    });
    const securitiesUpsertSelect = vi.fn().mockResolvedValue({ data: null, error: null });
    const securitiesUpsert = vi.fn().mockReturnValue({ select: securitiesUpsertSelect });
    const { tables, spies } = tableStub({ securities: { upsert: securitiesUpsert } });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    const result = await syncInvestmentsForItem(item);
    expect(result).toEqual({ outcome: "synced", holdingsSynced: 0 });
    expect(spies.holdingsUpsert).not.toHaveBeenCalled();
  });

  it("filters out a holding whose account is not in the item account map", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: {
        accounts: [{ account_id: "plaid-acc-1" }],
        holdings: [{ account_id: "unknown-acc", security_id: "sec-plaid-1", quantity: 5 }],
        securities: [{ security_id: "sec-plaid-1" }],
      },
    });
    const { tables, spies } = tableStub();
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    const result = await syncInvestmentsForItem(item);
    expect(result).toEqual({ outcome: "synced", holdingsSynced: 0 });
    expect(spies.holdingsUpsert).not.toHaveBeenCalled();
  });

  it("maps missing holding fields to nulls and pairs snapshots by upserted key", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: {
        accounts: [{ account_id: "plaid-acc-1" }],
        holdings: [{ account_id: "plaid-acc-1", security_id: "sec-plaid-1" }],
        securities: [{ security_id: "sec-plaid-1", name: "VTI" }],
      },
    });
    const holdingsUpsertSelect = vi.fn().mockResolvedValue({
      data: [{ id: "holding-db-1", account_id: "db-acc-1", security_id: "sec-db-1" }],
      error: null,
    });
    const holdingsUpsert = vi.fn().mockReturnValue({ select: holdingsUpsertSelect });
    const holdingsSelect = vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
    const holdingsUpdate = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ error: null }),
    });
    const snapshotsUpsert = vi.fn().mockResolvedValue({ error: null });
    const { tables } = tableStub({
      holdings: { upsert: holdingsUpsert, select: holdingsSelect, update: holdingsUpdate },
      holding_snapshots: { upsert: snapshotsUpsert },
    });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    const result = await syncInvestmentsForItem(item);
    expect(result).toEqual({ outcome: "synced", holdingsSynced: 1 });
    expect(holdingsUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          quantity: null,
          cost_basis: null,
          institution_price: null,
          institution_value: null,
          as_of: null,
        }),
      ],
      { onConflict: "account_id,security_id,source" },
    );
    expect(snapshotsUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          holding_id: "holding-db-1",
          quantity: null,
          price: null,
          value: null,
        }),
      ],
      { onConflict: "holding_id,snapshot_date" },
    );
  });

  it("throws when the holdings upsert fails", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: {
        accounts: [{ account_id: "plaid-acc-1" }],
        holdings: [{ account_id: "plaid-acc-1", security_id: "sec-plaid-1" }],
        securities: [{ security_id: "sec-plaid-1" }],
      },
    });
    const holdingsUpsertSelect = vi.fn().mockResolvedValue({ data: null, error: new Error("Holdings error") });
    const holdingsUpsert = vi.fn().mockReturnValue({ select: holdingsUpsertSelect });
    const { tables } = tableStub({ holdings: { upsert: holdingsUpsert } });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    await expect(syncInvestmentsForItem(item)).rejects.toThrow("Holdings error");
  });

  it("tolerates a holdings upsert returning no rows", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: {
        accounts: [{ account_id: "plaid-acc-1" }],
        holdings: [{ account_id: "plaid-acc-1", security_id: "sec-plaid-1" }],
        securities: [{ security_id: "sec-plaid-1" }],
      },
    });
    const holdingsUpsertSelect = vi.fn().mockResolvedValue({ data: null, error: null });
    const holdingsUpsert = vi.fn().mockReturnValue({ select: holdingsUpsertSelect });
    const { tables } = tableStub({
      holdings: {
        upsert: holdingsUpsert,
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ error: null }) }),
      },
    });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    const result = await syncInvestmentsForItem(item);
    expect(result).toEqual({ outcome: "synced", holdingsSynced: 1 });
  });

  it("throws when the holding snapshot upsert fails", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: {
        accounts: [{ account_id: "plaid-acc-1" }],
        holdings: [{ account_id: "plaid-acc-1", security_id: "sec-plaid-1" }],
        securities: [{ security_id: "sec-plaid-1" }],
      },
    });
    const holdingsUpsertSelect = vi.fn().mockResolvedValue({
      data: [{ id: "holding-db-1", account_id: "db-acc-1", security_id: "sec-db-1" }],
      error: null,
    });
    const holdingsUpsert = vi.fn().mockReturnValue({ select: holdingsUpsertSelect });
    const snapshotsUpsert = vi.fn().mockResolvedValue({ error: new Error("Snapshot error") });
    const { tables } = tableStub({
      holdings: { upsert: holdingsUpsert },
      holding_snapshots: { upsert: snapshotsUpsert },
    });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    await expect(syncInvestmentsForItem(item)).rejects.toThrow("Snapshot error");
  });

  it("throws when the existing-holdings lookup fails", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: { accounts: [{ account_id: "plaid-acc-1" }], holdings: [], securities: [] },
    });
    const holdingsSelectEqEq = vi.fn().mockResolvedValue({ data: null, error: new Error("Existing error") });
    const holdingsSelectEq1 = vi.fn().mockReturnValue({ eq: holdingsSelectEqEq });
    const holdingsSelectIn = vi.fn().mockReturnValue({ eq: holdingsSelectEq1 });
    const holdingsSelect = vi.fn().mockReturnValue({ in: holdingsSelectIn });
    const { tables } = tableStub({ holdings: { select: holdingsSelect } });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    await expect(syncInvestmentsForItem(item)).rejects.toThrow("Existing error");
  });

  it("tolerates a null existing-holdings result", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: { accounts: [{ account_id: "plaid-acc-1" }], holdings: [], securities: [] },
    });
    const holdingsSelectEqEq = vi.fn().mockResolvedValue({ data: null, error: null });
    const holdingsSelectEq1 = vi.fn().mockReturnValue({ eq: holdingsSelectEqEq });
    const holdingsSelectIn = vi.fn().mockReturnValue({ eq: holdingsSelectEq1 });
    const holdingsSelect = vi.fn().mockReturnValue({ in: holdingsSelectIn });
    const holdingsUpdateIn = vi.fn();
    const holdingsUpdate = vi.fn().mockReturnValue({ in: holdingsUpdateIn });
    const { tables } = tableStub({
      holdings: { select: holdingsSelect, update: holdingsUpdate },
    });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    const result = await syncInvestmentsForItem(item);
    expect(result).toEqual({ outcome: "synced", holdingsSynced: 0 });
    expect(holdingsUpdate).not.toHaveBeenCalled();
  });

  it("throws when deactivating a stale holding fails", async () => {
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: { accounts: [{ account_id: "plaid-acc-1" }], holdings: [], securities: [] },
    });
    const holdingsUpsertSelect = vi.fn().mockResolvedValue({ data: [], error: null });
    const holdingsUpsert = vi.fn().mockReturnValue({ select: holdingsUpsertSelect });
    const holdingsSelectEqEq = vi.fn().mockResolvedValue({ data: [{ id: "stale-holding" }], error: null });
    const holdingsSelectEq1 = vi.fn().mockReturnValue({ eq: holdingsSelectEqEq });
    const holdingsSelectIn = vi.fn().mockReturnValue({ eq: holdingsSelectEq1 });
    const holdingsSelect = vi.fn().mockReturnValue({ in: holdingsSelectIn });
    const holdingsUpdateIn = vi.fn().mockResolvedValue({ error: new Error("Deactivate error") });
    const holdingsUpdate = vi.fn().mockReturnValue({ in: holdingsUpdateIn });
    const { tables } = tableStub({
      holdings: { upsert: holdingsUpsert, select: holdingsSelect, update: holdingsUpdate },
    });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    await expect(syncInvestmentsForItem(item)).rejects.toThrow("Deactivate error");
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

    expect(total).toBe(0);
    expect(mockLogError).toHaveBeenCalled();
  });

  it("records retriable outcomes and handles investment transaction errors gracefully", async () => {
    mockListActiveItems.mockResolvedValueOnce([item]);
    mockInvestmentsHoldingsGet.mockRejectedValueOnce({
      response: { data: { error_code: "PRODUCT_NOT_READY" } },
    });
    mockInvestmentsTransactionsGet.mockRejectedValueOnce(new Error("Txn fetch error"));

    const { tables } = tableStub();
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    const total = await syncInvestmentsForUser("user-1");
    expect(total).toBe(0);
    expect(mockLogError).toHaveBeenCalledWith("investment-sync.transactions", expect.any(Error));
  });

  it("handles recordInvestmentJob errors gracefully", async () => {
    mockListActiveItems.mockResolvedValueOnce([item]);
    mockInvestmentsHoldingsGet.mockResolvedValueOnce({
      data: { accounts: [{ account_id: "plaid-acc-1" }], holdings: [], securities: [] },
    });
    const { tables } = tableStub({
      sync_jobs: { insert: vi.fn().mockResolvedValue({ error: new Error("Job DB Error") }) },
    });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    await syncInvestmentsForUser("user-1");
    expect(mockLogError).toHaveBeenCalledWith("investment-sync.job-record", expect.any(Error));
  });

  it("records sync_failed when the error carries no Plaid code", async () => {
    mockListActiveItems.mockResolvedValueOnce([item]);
    mockInvestmentsHoldingsGet.mockRejectedValueOnce(new Error("Network failure"));
    mockInvestmentsTransactionsGet.mockResolvedValueOnce({
      data: { investment_transactions: [], total_investment_transactions: 0 },
    });
    const { tables, spies } = tableStub();
    mockServiceClient.from.mockImplementation((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
      return tables[table as keyof typeof tables];
    });

    const total = await syncInvestmentsForUser("user-1");
    expect(total).toBe(0);
    expect(spies.syncJobsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", last_error: "sync_failed" }),
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

  it.each([
    ["PRODUCT_NOT_READY", "product_not_ready"],
    ["ADDITIONAL_CONSENT_REQUIRED", "no_investment_product"],
    ["RATE_LIMIT_EXCEEDED", "rate_limited"],
  ] as const)("maps Plaid error %s to %s without throwing", async (errorCode, outcome) => {
    mockInvestmentsTransactionsGet.mockRejectedValueOnce({
      response: { data: { error_code: errorCode } },
    });
    const result = await syncInvestmentTransactionsForItem(item, "2026-07-30");
    expect(result).toEqual({ outcome, transactionsSynced: 0 });
  });

  it("rethrows an unrecognized Plaid error during transaction sync", async () => {
    mockInvestmentsTransactionsGet.mockRejectedValueOnce({
      response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } },
    });
    await expect(syncInvestmentTransactionsForItem(item, "2026-07-30")).rejects.toBeTruthy();
  });

  it("throws when the accounts lookup fails during transaction sync", async () => {
    mockInvestmentsTransactionsGet.mockResolvedValueOnce({
      data: {
        investment_transactions: [
          {
            investment_transaction_id: "t1",
            account_id: "plaid-acc-1",
            security_id: "sec-plaid-1",
            date: "2026-07-15",
            amount: 100,
          },
        ],
        total_investment_transactions: 1,
      },
    });
    const accountsSelectEq = vi.fn().mockResolvedValue({ data: null, error: new Error("Accounts error") });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "accounts") return { select: () => ({ eq: accountsSelectEq }) };
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(syncInvestmentTransactionsForItem(item, "2026-07-30")).rejects.toThrow("Accounts error");
  });

  it("tolerates a null item-accounts result during transaction sync", async () => {
    mockInvestmentsTransactionsGet.mockResolvedValueOnce({
      data: {
        investment_transactions: [
          {
            investment_transaction_id: "t1",
            account_id: "plaid-acc-1",
            security_id: "sec-plaid-1",
            date: "2026-07-15",
            amount: 100,
          },
        ],
        total_investment_transactions: 1,
      },
    });
    const accountsSelectEq = vi.fn().mockResolvedValue({ data: null, error: null });
    const securitiesSelectIn = vi.fn().mockResolvedValue({
      data: [{ id: "sec-db-1", plaid_security_id: "sec-plaid-1" }],
      error: null,
    });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "accounts") return { select: () => ({ eq: accountsSelectEq }) };
      if (table === "securities") return { select: () => ({ in: securitiesSelectIn }) };
      if (table === "investment_transactions") return { upsert: vi.fn(), update: vi.fn() };
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await syncInvestmentTransactionsForItem(item, "2026-07-30");
    expect(result).toEqual({ outcome: "synced", transactionsSynced: 0 });
  });

  it("throws when the securities lookup fails during transaction sync", async () => {
    mockInvestmentsTransactionsGet.mockResolvedValueOnce({
      data: {
        investment_transactions: [
          {
            investment_transaction_id: "t1",
            account_id: "plaid-acc-1",
            security_id: "sec-plaid-1",
            date: "2026-07-15",
            amount: 100,
          },
        ],
        total_investment_transactions: 1,
      },
    });
    const accountsSelectEq = vi.fn().mockResolvedValue({
      data: [{ id: "db-acc-1", plaid_account_id: "plaid-acc-1" }],
      error: null,
    });
    const securitiesSelectIn = vi.fn().mockResolvedValue({ data: null, error: new Error("Securities error") });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "accounts") return { select: () => ({ eq: accountsSelectEq }) };
      if (table === "securities") return { select: () => ({ in: securitiesSelectIn }) };
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(syncInvestmentTransactionsForItem(item, "2026-07-30")).rejects.toThrow("Securities error");
  });

  it("maps an unknown security id to null in a transaction row", async () => {
    mockInvestmentsTransactionsGet.mockResolvedValueOnce({
      data: {
        investment_transactions: [
          {
            investment_transaction_id: "t1",
            account_id: "plaid-acc-1",
            security_id: "sec-plaid-1",
            date: "2026-07-15",
            amount: 100,
          },
        ],
        total_investment_transactions: 1,
      },
    });
    const accountsSelectEq = vi.fn().mockResolvedValue({
      data: [{ id: "db-acc-1", plaid_account_id: "plaid-acc-1" }],
      error: null,
    });
    const securitiesSelectIn = vi.fn().mockResolvedValue({ data: null, error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "accounts") return { select: () => ({ eq: accountsSelectEq }) };
      if (table === "securities") return { select: () => ({ in: securitiesSelectIn }) };
      if (table === "investment_transactions") return { upsert, update: vi.fn() };
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await syncInvestmentTransactionsForItem(item, "2026-07-30");
    expect(result).toEqual({ outcome: "synced", transactionsSynced: 1 });
    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ security_id: null })],
      { onConflict: "plaid_investment_transaction_id" },
    );
  });

  it("maps missing transaction fields to null", async () => {
    mockInvestmentsTransactionsGet.mockResolvedValueOnce({
      data: {
        investment_transactions: [
          {
            investment_transaction_id: "t1",
            account_id: "plaid-acc-1",
            date: "2026-07-15",
            amount: 100,
          },
        ],
        total_investment_transactions: 1,
      },
    });
    const accountsSelectEq = vi.fn().mockResolvedValue({
      data: [{ id: "db-acc-1", plaid_account_id: "plaid-acc-1" }],
      error: null,
    });
    const securitiesSelectIn = vi.fn().mockResolvedValue({ data: null, error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "accounts") return { select: () => ({ eq: accountsSelectEq }) };
      if (table === "securities") return { select: () => ({ in: securitiesSelectIn }) };
      if (table === "investment_transactions") return { upsert, update: vi.fn() };
      throw new Error(`Unexpected table ${table}`);
    });

    await syncInvestmentTransactionsForItem(item, "2026-07-30");

    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          name: null,
          quantity: null,
          price: null,
          fees: null,
          txn_type: null,
          txn_subtype: null,
          iso_currency_code: null,
        }),
      ],
      { onConflict: "plaid_investment_transaction_id" },
    );
  });

  it("throws when the investment transaction upsert fails", async () => {
    mockInvestmentsTransactionsGet.mockResolvedValueOnce({
      data: {
        investment_transactions: [
          {
            investment_transaction_id: "t1",
            account_id: "plaid-acc-1",
            security_id: "sec-plaid-1",
            date: "2026-07-15",
            amount: 100,
          },
        ],
        total_investment_transactions: 1,
      },
    });
    const accountsSelectEq = vi.fn().mockResolvedValue({
      data: [{ id: "db-acc-1", plaid_account_id: "plaid-acc-1" }],
      error: null,
    });
    const securitiesSelectIn = vi.fn().mockResolvedValue({ data: null, error: null });
    const upsert = vi.fn().mockResolvedValue({ error: new Error("Txn upsert error") });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "accounts") return { select: () => ({ eq: accountsSelectEq }) };
      if (table === "securities") return { select: () => ({ in: securitiesSelectIn }) };
      if (table === "investment_transactions") return { upsert, update: vi.fn() };
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(syncInvestmentTransactionsForItem(item, "2026-07-30")).rejects.toThrow("Txn upsert error");
  });

  it("throws when deactivating a cancelled transaction fails", async () => {
    mockInvestmentsTransactionsGet.mockResolvedValueOnce({
      data: {
        investment_transactions: [
          {
            investment_transaction_id: "t-cancel",
            cancel_transaction_id: "t1",
            account_id: "plaid-acc-1",
            date: "2026-07-16",
            amount: -1,
          },
        ],
        total_investment_transactions: 1,
      },
    });
    const accountsSelectEq = vi.fn().mockResolvedValue({
      data: [{ id: "db-acc-1", plaid_account_id: "plaid-acc-1" }],
      error: null,
    });
    const securitiesSelectIn = vi.fn().mockResolvedValue({ data: null, error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const updateIn = vi.fn().mockResolvedValue({ error: new Error("Cancel error") });
    const update = vi.fn().mockReturnValue({ in: updateIn });
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "accounts") return { select: () => ({ eq: accountsSelectEq }) };
      if (table === "securities") return { select: () => ({ in: securitiesSelectIn }) };
      if (table === "investment_transactions") return { upsert, update };
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(syncInvestmentTransactionsForItem(item, "2026-07-30")).rejects.toThrow("Cancel error");
  });
});
