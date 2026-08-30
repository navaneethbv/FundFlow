import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLiabilitiesGet = vi.fn();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    liabilitiesGet: (...args: unknown[]) => mockLiabilitiesGet(...args),
  }),
}));

const mockServiceClient = { from: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockDecryptItemTokenAndUpgrade = vi.fn().mockResolvedValue("token");
vi.mock("@/lib/plaid-service", () => ({
  decryptItemTokenAndUpgrade: (...args: unknown[]) => mockDecryptItemTokenAndUpgrade(...args),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { syncCreditCardLiabilities } from "@/lib/liabilities-sync";
import type { PlaidItemRow } from "@/lib/types";

const item: PlaidItemRow = {
  id: "item-db-1",
  user_id: "user-1",
  plaid_item_id: "plaid-item-1",
  institution_id: "inst-1",
  institution_name: "Chase",
  access_token_ciphertext: "c",
  access_token_iv: "iv",
  access_token_tag: "tag",
  sync_cursor: null,
  status: "active",
  error_code: null,
};

function billAccountStub() {
  const accountQuery = {
    eq: vi.fn().mockImplementation((column: string) => {
      if (column === "user_id") {
        return Promise.resolve({
          data: [{ id: "db-credit-1", plaid_account_id: "plaid-credit-1" }],
          error: null,
        });
      }
      return accountQuery;
    }),
  };
  const select = vi.fn().mockReturnValue(accountQuery);
  const upsert = vi.fn().mockResolvedValue({ error: null });
  mockServiceClient.from.mockImplementation((table: string) => {
    if (table === "accounts") return { select };
    if (table === "credit_card_bills") return { upsert };
    throw new Error(`Unexpected table ${table}`);
  });
  return { upsert, select, accountQuery };
}

describe("syncCreditCardLiabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts statement balance, minimum payment, and due date, scoped to the owner", async () => {
    const { upsert, select, accountQuery } = billAccountStub();
    mockLiabilitiesGet.mockResolvedValue({
      data: {
        accounts: [{ account_id: "plaid-credit-1" }],
        liabilities: {
          credit: [
            {
              account_id: "plaid-credit-1",
              minimum_payment_amount: 25,
              last_statement_balance: 1200,
              last_payment_amount: 1200,
              is_overdue: false,
            },
          ],
        },
      },
    });

    const result = await syncCreditCardLiabilities(item);
    expect(result).toEqual({ outcome: "synced", billsSynced: 1 });
    const payload = upsert.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(payload[0]).toMatchObject({
      user_id: "user-1",
      account_id: "db-credit-1",
      statement_balance: 1200,
      minimum_payment: 25,
    });
    expect(payload[0].due_date).toBeNull();
    expect(payload[0].sync_timestamp).toBeTruthy();
    expect(select.mock.calls[0]?.[0]).toBe("id, plaid_account_id");
    expect(accountQuery.eq).toHaveBeenNthCalledWith(1, "plaid_item_id", "item-db-1");
    expect(accountQuery.eq).toHaveBeenNthCalledWith(2, "user_id", "user-1");
  });

  it("maps the due date and treats a missing credit product distinctly", async () => {
    const { upsert } = billAccountStub();
    mockLiabilitiesGet.mockResolvedValue({
      data: {
        accounts: [{ account_id: "plaid-credit-1" }],
        liabilities: {
          credit: [
            {
              account_id: "plaid-credit-1",
              last_statement_balance: 800,
              last_payment_date: "2026-07-25",
              next_payment_due_date: "2026-08-25",
              last_payment_amount: 800,
              minimum_payment_amount: 20,
              is_overdue: false,
            },
          ],
        },
      },
    });
    const result = await syncCreditCardLiabilities(item);
    expect(result.outcome).toBe("synced");
    const payload = upsert.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(payload[0].statement_balance).toBe(800);
    expect(payload[0].due_date).toBe("2026-08-25");
  });

  it("reports product_not_ready distinctly without touching the database", async () => {
    mockLiabilitiesGet.mockRejectedValue({
      response: { data: { error_code: "PRODUCT_NOT_READY" } },
    });
    const result = await syncCreditCardLiabilities(item);
    expect(result).toEqual({ outcome: "product_not_ready", billsSynced: 0 });
    expect(mockServiceClient.from).not.toHaveBeenCalled();
  });

  it("reports rate limiting as a retriable outcome", async () => {
    mockLiabilitiesGet.mockRejectedValue({
      response: { data: { error_code: "RATE_LIMIT_EXCEEDED" } },
    });
    const result = await syncCreditCardLiabilities(item);
    expect(result.outcome).toBe("rate_limited");
  });

  it("never invents a bill when no credit liabilities exist", async () => {
    billAccountStub();
    mockLiabilitiesGet.mockResolvedValue({
      data: { accounts: [], liabilities: { credit: [] } },
    });
    const result = await syncCreditCardLiabilities(item);
    expect(result).toEqual({ outcome: "no_liabilities", billsSynced: 0 });
  });
});
