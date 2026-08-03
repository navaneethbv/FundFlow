import { describe, expect, it } from "vitest";
import { getRecentTransactions } from "@/lib/recent-transactions";
import { clientStub } from "../fixtures/supabase-query";

describe("getRecentTransactions", () => {
  it("loads recent transactions with userId, accountId, and December month rollover", async () => {
    const supabase = clientStub({
      transactions: {
        data: [
          {
            id: "t1",
            date: "2026-12-15",
            amount: 25,
            iso_currency_code: "USD",
            merchant_name: "Store",
            name: "STORE",
            pfc_primary: "GENERAL_MERCHANDISE",
            account_id: "acc-1",
          },
        ],
      },
    });

    const result = await getRecentTransactions({
      supabase: supabase as never,
      month: "2026-12",
      accountId: "acc-1",
      userId: "user-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("loads recent transactions without accountId or userId for standard month", async () => {
    const supabase = clientStub({
      transactions: { data: [] },
    });

    const result = await getRecentTransactions({
      supabase: supabase as never,
      month: "2026-07",
    });

    expect(result).toEqual([]);
  });
});
