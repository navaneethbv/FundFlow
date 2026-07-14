import { describe, it, expect, vi } from "vitest";
import { getWeeklyReportData } from "@/lib/weekly-report-data";

describe("getWeeklyReportData", () => {
  it("fetches and maps all weekly report data sources correctly", async () => {
    const mockSupabase = {
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { email: "user@example.com" } },
            error: null,
          }),
        },
      },
      from: vi.fn().mockImplementation((table) => {
        let data: unknown[] = [];
        if (table === "accounts") {
          data = [
            {
              id: "acc-1",
              name: "Checking",
              type: "depository",
              plaid_item_id: "item-1",
            },
          ];
        } else if (table === "plaid_items") {
          data = [{ id: "item-1", institution_name: "Chase" }];
        } else if (table === "budgets") {
          data = [{ category: "FOOD", monthly_limit: 500 }];
        } else if (table === "merchant_rules") {
          data = [
            {
              match_type: "keyword",
              pattern: "Store",
              display_name: "My Store",
              category: "SHOPPING",
              enabled: true,
            },
          ];
        } else if (table === "linked_refunds") {
          data = [
            { charge_transaction_id: "tx-1", refund_transaction_id: "tx-2" },
          ];
        } else if (table === "transaction_review_decisions") {
          data = [{ subject_id: "tx-3" }];
        } else if (table === "transactions") {
          data = [
            {
              id: "tx-4",
              date: "2026-07-10",
              amount: 20,
              name: "Groceries",
              merchant_name: "Grocery Store",
              category: "FOOD",
              account_id: "acc-1",
            },
          ];
        } else if (table === "transaction_splits") {
          data = [{ transaction_id: "tx-4", category: "FOOD", amount: 20 }];
        }

        const query = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data, error: null }),
          then: undefined as unknown as (onfulfilled: (value: { data: unknown[]; error: unknown }) => unknown) => unknown,
        };
        query.then = (onfulfilled) =>
          Promise.resolve({ data, error: null }).then(onfulfilled);
        return query;
      }),
    } as never;

    const period = {
      start: "2026-07-06",
      end: "2026-07-12",
      previousStart: "2026-06-29",
      previousEnd: "2026-07-05",
    };

    const result = await getWeeklyReportData(mockSupabase, "user-1", period);
    expect(result).not.toBeNull();
    expect(result?.userEmail).toBe("user@example.com");
    expect(result?.totalSpend).toBe(20);
  });
});
