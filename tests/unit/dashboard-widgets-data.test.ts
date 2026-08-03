import { describe, expect, it } from "vitest";
import { loadCumulativeSpend, EMPTY_CUMULATIVE_SPEND } from "@/lib/dashboard-widgets-data";
import { clientStub } from "../fixtures/supabase-query";

describe("loadCumulativeSpend", () => {
  it("loads cumulative spend view for single user", async () => {
    const supabase = clientStub({
      transactions: {
        data: [
          {
            id: "t1",
            user_id: "user-1",
            account_id: "acc-1",
            date: "2026-07-10",
            amount: 50,
            pfc_primary: "FOOD_AND_DRINK",
            pending: false,
          },
        ],
      },
      accounts: { data: [] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    });

    const result = await loadCumulativeSpend(supabase as never, {
      month: "2026-07",
      today: "2026-07-15",
      userId: "user-1",
      household: false,
    });

    expect(result.monthLabel).toContain("Jul");
    expect(result.previousMonthLabel).toContain("Jun");
    expect(result.days).toBeDefined();
  });

  it("loads cumulative spend view for household scope", async () => {
    const supabase = clientStub({
      transactions: { data: [] },
      accounts: { data: [] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    });

    const result = await loadCumulativeSpend(supabase as never, {
      month: "2026-07",
      today: "2026-07-15",
      userId: "user-1",
      household: true,
    });

    expect(result.monthLabel).toContain("Jul");
  });

  it("provides EMPTY_CUMULATIVE_SPEND constant", () => {
    expect(EMPTY_CUMULATIVE_SPEND.days).toEqual([]);
    expect(EMPTY_CUMULATIVE_SPEND.monthLabel).toBe("");
  });
});
