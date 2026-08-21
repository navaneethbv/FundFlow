import { describe, expect, it } from "vitest";
import { expandStreamsForMonth, occurrenceDatesInWindow } from "@/lib/recurring-page";
import { buildCategoryDrilldown, buildMerchantDrilldown } from "@/lib/drilldown";
import { fetchFinanceTransactions, monthWindow, loadCanonicalProjection } from "@/lib/finance-query";
import { clientStub } from "../fixtures/supabase-query";

describe("Recurring Page Edge Branches", () => {
  it("processes streams and manual items with overdue, fallback descriptions, and excluded categories", () => {
    const data = expandStreamsForMonth(
      [
        {
          id: "s1",
          streamType: "inflow",
          category: "TRANSFER_IN", // in EXCLUDED_PFC
          frequency: "MONTHLY",
          merchantName: null,
          description: null, // falls back to "Unknown"
          accountName: "Checking",
          isCreditAccount: false,
          userAmount: null,
          averageAmount: null,
          lastAmount: 1500,
          firstDate: "2026-01-01",
          lastDate: "2026-07-01",
          predictedNextDate: "2026-08-01",
          status: "MATURE",
          isActive: true,
          reviewedAt: null,
          dismissedAt: null,
          matchedTransactions: [],
        },
      ],
      [
        {
          id: "m1",
          name: "Old Bill",
          amount: 50,
          frequency: "monthly",
          nextDate: "2026-08-10",
          category: "Utilities",
          itemType: "expense",
          enabled: true,
        },
        {
          id: "m2",
          name: "Future Income",
          amount: 200,
          frequency: "monthly",
          nextDate: "2026-08-25",
          category: "Side Gig",
          itemType: "income",
          enabled: true,
        },
      ],
      "2026-08",
      "2026-08-20", // today is Aug 20, so Aug 10 is overdue and Aug 25 is upcoming
    );

    expect(data.occurrences.length).toBeGreaterThan(0);
    const overdue = data.occurrences.find((o) => o.merchant === "Old Bill");
    expect(overdue?.status).toBe("overdue");
    const upcoming = data.occurrences.find((o) => o.merchant === "Future Income");
    expect(upcoming?.status).toBe("upcoming");
    const unknown = data.occurrences.find((o) => o.merchant === "Unknown");
    expect(unknown).toBeDefined();
  });

  it("calculates occurrence dates in window", () => {
    const dates = occurrenceDatesInWindow(
      "2026-08-01",
      { unit: "months", amount: 1 },
      "2026-08-01",
      "2026-10-01",
    );
    expect(dates).toEqual(["2026-08-01", "2026-09-01"]);
  });
});

describe("Drilldown Edge Branches", () => {
  it("handles drilldown with tie-breaking sorting and split transactions", () => {
    const drilldown = buildCategoryDrilldown({
      category: "FOOD_AND_DRINK",
      sub: null,
      activeMonth: "2026-07", // index 0, tests prevAmount = 0
      months: ["2026-07", "2026-08"],
      txns: [
        {
          id: "t1",
          date: "2026-07-10",
          amount: 50,
          merchant: "Store B",
          category: "FOOD_AND_DRINK",
          subcategory: "FOOD_AND_DRINK_GROCERIES_B",
        },
        {
          id: "t2",
          date: "2026-07-10",
          amount: 50,
          merchant: "Store A", // same amount as Store B, tests merchant name tie-break
          category: "FOOD_AND_DRINK",
          subcategory: "FOOD_AND_DRINK_GROCERIES_A", // same amount, tests subcategory tie-break
        },
      ],
      splits: [
        {
          transactionId: "t1",
          category: "FOOD_AND_DRINK",
          amount: 25,
        },
        {
          transactionId: "t1",
          category: "FOOD_AND_DRINK", // second split in same category -> existing is true
          amount: 25,
        },
      ],
    });

    expect(drilldown.total).toBe(100);
    expect(drilldown.merchants.length).toBeGreaterThan(0);

    const merchantDrill = buildMerchantDrilldown({
      merchant: "Store A",
      months: ["2026-07", "2026-08"],
      txns: [
        {
          id: "t1",
          date: "2026-07-05",
          amount: 30,
          merchant: "Store A",
          category: null, // null category
          subcategory: null,
        },
        {
          id: "t2",
          date: "2026-07-10",
          amount: 40,
          merchant: "Store A",
          category: "FOOD",
          subcategory: null,
        },
      ],
    });
    expect(merchantDrill.total).toBe(70);
    expect(merchantDrill.dominantCategory).toBe("FOOD");
  });
});

describe("Finance Query Scope and Pagination Branches", () => {
  it("fetches finance transactions with pagination and windows", async () => {
    const window = monthWindow("2026-08", 1);
    expect(window.start).toBe("2026-07-01");
    expect(window.endExclusive).toBe("2026-09-01");

    const client = clientStub({
      transactions: {
        data: [
          {
            id: "tx-1",
            user_id: "u-1",
            account_id: "acc-1",
            manual_account_id: null,
            plaid_transaction_id: "plaid-1",
            date: "2026-08-10",
            amount: 50,
            merchant_name: "Store",
            name: "Store",
            pfc_primary: "FOOD_AND_DRINK",
            pfc_detailed: "GROCERIES",
            pending: false,
          },
        ],
      },
    });

    const result = await fetchFinanceTransactions(client as never, {
      scope: { kind: "mine", ownerUserId: "u-1" },
      window,
      excludePending: true,
      pageSize: 10,
      maxRows: 5,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it("handles loadCanonicalProjection query errors with and without error codes", async () => {
    const window = monthWindow("2026-08", 1);
    const clientErrorWithCode = {
      from: () => ({
        select: () => ({
          gte: () => ({
            lt: () => ({
              order: () => ({
                order: () => ({
                  range: () => Promise.resolve({ data: null, error: { code: "42P01" } }),
                }),
              }),
            }),
          }),
        }),
      }),
    };

    await expect(
      loadCanonicalProjection(clientErrorWithCode as never, {
        scope: { kind: "mine", ownerUserId: "u-1" },
        window,
      }),
    ).rejects.toThrow("finance_projection_query_failed");

    const clientErrorNoCode = {
      from: () => ({
        select: () => ({
          gte: () => ({
            lt: () => ({
              order: () => ({
                order: () => ({
                  range: () => Promise.resolve({ data: null, error: { message: "General DB error" } }),
                }),
              }),
            }),
          }),
        }),
      }),
    };

    await expect(
      loadCanonicalProjection(clientErrorNoCode as never, {
        scope: { kind: "mine", ownerUserId: "u-1" },
        window,
      }),
    ).rejects.toThrow("finance_projection_query_failed");
  });
});
