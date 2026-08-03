import { describe, expect, it } from "vitest";
import { loadGoalsPageData } from "@/lib/goals-data";
import { clientStub } from "../fixtures/supabase-query";

describe("loadGoalsPageData", () => {
  it("loads goals page data with accounts, links, events, and goals", async () => {
    const supabase = clientStub({
      goals: {
        data: [
          {
            id: "g1",
            name: "Emergency Fund",
            target_amount: 10000,
            saved_amount: 2000,
            target_date: "2027-01-01",
            household_id: null,
            goal_type: "save_up",
            image_slug: "shield",
            monthly_contribution: 500,
            spending_reduces: false,
            starting_balance: null,
            target_balance: null,
          },
          {
            id: "g2",
            name: "Card Paydown",
            target_amount: 3000,
            saved_amount: 0,
            target_date: "2026-12-31",
            household_id: null,
            goal_type: "pay_down",
            image_slug: "card",
            monthly_contribution: null,
            spending_reduces: true,
            starting_balance: 5000,
            target_balance: 2000,
          },
        ],
      },
      goal_accounts: {
        data: [
          {
            goal_id: "g1",
            account_id: "acc-1",
            allocated_amount: 1500,
            use_entire_balance: false,
          },
        ],
      },
      goal_progress_events: {
        data: [
          {
            goal_id: "g1",
            event_date: "2026-06-01",
            amount: 500,
          },
        ],
      },
      accounts: {
        data: [
          {
            id: "acc-1",
            name: "Savings",
            current_balance: "5000.50",
            type: "depository",
          },
        ],
      },
    });

    const data = await loadGoalsPageData(supabase as never, "user-1", new Date("2026-07-15"));

    expect(data.goals).toHaveLength(2);
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0].current_balance).toBe(5000.5);
    expect(data.accountNames.get("acc-1")).toBe("Savings");
    expect(data.linksByGoal.get("g1")).toHaveLength(1);
  });

  it("throws formatted error if any query returns an error", async () => {
    const supabase = clientStub({
      goals: { error: { code: "PGRST100" } },
      goal_accounts: { data: [] },
      goal_progress_events: { data: [] },
      accounts: { data: [] },
    });

    await expect(
      loadGoalsPageData(supabase as never, "user-1", new Date("2026-07-15")),
    ).rejects.toThrow("goals_query_failed:goals:PGRST100");
  });
});
