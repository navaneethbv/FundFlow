import { describe, expect, it } from "vitest";
import {
  buildDashboardBudgetGroups,
  EMPTY_CUMULATIVE_SPEND,
  loadCumulativeSpend,
  loadDashboardInvestmentSummary,
  loadOverviewWidgetData,
} from "@/lib/dashboard-widgets-data";
import type { BudgetEnvelope } from "@/lib/planning";
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

function envelope(
  category: string,
  monthlyLimit: number,
  spent: number,
  status: BudgetEnvelope["status"] = "on-track",
): BudgetEnvelope {
  return {
    category,
    monthlyLimit,
    spent,
    remaining: monthlyLimit - spent,
    projectedSpend: spent,
    status,
    lastMonthSpend: 0,
    threeMonthAverage: 0,
    carry: 0,
    effectiveLimit: monthlyLimit,
  };
}

describe("buildDashboardBudgetGroups", () => {
  it("returns the three expense groups and preserves planned and spent sums", () => {
    const groups = buildDashboardBudgetGroups(
      [
        { category: "Rent", groupName: "fixed" },
        { category: "Dining", groupName: "flexible" },
        { category: "Insurance", groupName: "non_monthly" },
        { category: "Paycheck", groupName: "income" },
      ],
      [
        envelope("Rent", 2000, 2000),
        envelope("Dining", 500, 300),
        envelope("Insurance", 120, 40),
        envelope("Paycheck", 6000, 6000),
      ],
    );

    expect(groups.map((group) => group.label)).toEqual([
      "Fixed",
      "Flexible",
      "Non-monthly",
    ]);
    expect(groups.reduce((sum, group) => sum + group.monthlyLimit, 0)).toBe(2620);
    expect(groups.reduce((sum, group) => sum + group.spent, 0)).toBe(2340);
  });

  it("uses the worst category status and treats zero planned spend as over", () => {
    const groups = buildDashboardBudgetGroups(
      [
        { category: "Utilities", groupName: "fixed" },
        { category: "Fees", groupName: "fixed" },
      ],
      [
        envelope("Utilities", 200, 150, "at-risk"),
        envelope("Fees", 0, 25, "over"),
      ],
    );

    expect(groups).toEqual([
      {
        key: "fixed",
        label: "Fixed",
        monthlyLimit: 200,
        spent: 175,
        remaining: 25,
        status: "over",
      },
    ]);
  });

  it("defaults an unknown expense group to flexible", () => {
    expect(
      buildDashboardBudgetGroups(
        [{ category: "Other", groupName: "legacy" }],
        [envelope("Other", 50, 10)],
      ),
    ).toMatchObject([{ key: "flexible", spent: 10 }]);
  });
});

describe("loadDashboardInvestmentSummary", () => {
  it("uses only the latest two snapshot dates for day change and top movers", async () => {
    const supabase = clientStub({
      holdings: {
        data: [
          {
            id: "holding-1",
            account_id: null,
            manual_account_id: null,
            quantity: 10,
            institution_price: 15,
            institution_value: 150,
            source: "manual",
            is_active: true,
            securities: {
              name: "Fund A",
              ticker: "FUNDA",
              security_type: "etf",
              close_price: 15,
            },
          },
        ],
      },
      holding_snapshots: {
        data: [
          { holding_id: "holding-1", snapshot_date: "2026-07-01", quantity: 10, price: 5, value: 50 },
          { holding_id: "holding-1", snapshot_date: "2026-07-09", quantity: 10, price: 10, value: 100 },
          { holding_id: "holding-1", snapshot_date: "2026-07-10", quantity: 10, price: 15, value: 150 },
        ],
      },
    });

    const result = await loadDashboardInvestmentSummary(supabase as never);

    expect(result.total).toBe(150);
    expect(result.dayChange).toEqual({ amount: 50, pct: 50 });
    expect(result.topMovers).toEqual([
      { id: "holding-1", name: "Fund A", ticker: "FUNDA", changePct: 50 },
    ]);
  });

  it("throws error when holding_snapshots query fails", async () => {
    const supabase = clientStub({
      holding_snapshots: { data: null, error: { message: "Query error" } },
    });

    await expect(loadDashboardInvestmentSummary(supabase as never)).rejects.toThrow("Query error");
  });
});

describe("loadOverviewWidgetData", () => {
  const options = {
    month: "2026-07",
    today: "2026-07-15",
    userId: "user-1",
    household: false,
    accounts: [] as never[],
  };

  it("does not issue spend or investment queries when both widgets are hidden", async () => {
    const supabase = clientStub();
    const result = await loadOverviewWidgetData(supabase as never, {
      ...options,
      visible: ["budget"],
    });

    expect(supabase.from).not.toHaveBeenCalled();
    expect(result.cumulativeSpend).toEqual(EMPTY_CUMULATIVE_SPEND);
    expect(result.investments).toBeNull();
  });

  it("loads investments without loading cumulative spend when only investments is visible", async () => {
    const supabase = clientStub({ holdings: { data: [] }, holding_snapshots: { data: [] } });
    await loadOverviewWidgetData(supabase as never, {
      ...options,
      visible: ["investments"],
    });

    expect(supabase.from).toHaveBeenCalledWith("holdings");
    expect(supabase.from).not.toHaveBeenCalledWith("transactions");
  });

  it("loads cumulative spend, investments, and ledger ticks when all are active with an anchor account", async () => {
    const fakeAccount = {
      id: "acct-dep-1",
      name: "Checking",
      mask: "1234",
      current_balance: 1500,
      iso_currency_code: "EUR",
      type: "depository",
      user_id: "user-1",
    };
    const supabase = clientStub({
      transactions: {
        data: [
          {
            id: "t1",
            user_id: "user-1",
            account_id: "acct-dep-1",
            date: "2026-07-10",
            amount: 50,
            pfc_primary: "FOOD_AND_DRINK",
            pending: false,
            merchant_name: "Bistro",
            name: null,
          },
        ],
      },
      accounts: { data: [] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
      holdings: { data: [] },
      holding_snapshots: { data: [] },
    });

    const result = await loadOverviewWidgetData(supabase as never, {
      ...options,
      visible: ["spendingCompare", "investments"],
      accounts: [fakeAccount],
    });

    expect(result.cumulativeSpend.days).toBeDefined();
    expect(result.investments).toEqual({ total: 0, dayChange: null, topMovers: null });
    expect(result.ledgerStrip.account).toEqual(fakeAccount);
    expect(result.ledgerStrip.currency).toBe("EUR");
    expect(result.ledgerStrip.ticks).toHaveLength(1);
    expect(result.ledgerStrip.ticks[0]!.amount).toBe(-50);
  });

  it("anchors household ledger history to the current user's account", async () => {
    const sharedAccount = {
      id: "acct-shared",
      name: "Shared Checking",
      mask: "1111",
      current_balance: 900,
      iso_currency_code: "USD",
      type: "depository",
      user_id: "user-2",
    };
    const ownAccount = {
      id: "acct-own",
      name: "My Checking",
      mask: "2222",
      current_balance: 1500,
      iso_currency_code: "USD",
      type: "depository",
      user_id: "user-1",
    };
    const supabase = clientStub({ transactions: { data: [] } });

    const result = await loadOverviewWidgetData(supabase as never, {
      ...options,
      household: true,
      visible: [],
      accounts: [sharedAccount, ownAccount],
    });

    expect(result.ledgerStrip.account?.id).toBe("acct-own");
  });

  it("handles anchor account with null current_balance and null iso_currency_code gracefully", async () => {
    const fakeAccount = {
      id: "acct-dep-2",
      name: "Savings",
      mask: "5678",
      current_balance: null,
      iso_currency_code: null,
      type: "depository",
    };
    // If pickAnchorAccount only picks non-null balance, but if an account is passed or manually constructed:
    const supabase = clientStub({
      transactions: { data: [] },
      accounts: { data: [] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    });

    // When accounts only has null balance, pickAnchorAccount returns null -> defaults to [] and "USD"
    const result = await loadOverviewWidgetData(supabase as never, {
      ...options,
      visible: ["spendingCompare"],
      accounts: [fakeAccount],
    });

    expect(result.ledgerStrip.ticks).toEqual([]);
    expect(result.ledgerStrip.account).toBeNull();
    expect(result.ledgerStrip.currency).toBe("USD");
  });

  it("defaults currency to USD when anchorAccount has null iso_currency_code", async () => {
    const fakeAccount = {
      id: "acct-dep-3",
      name: "Checking",
      mask: "9999",
      current_balance: 100,
      iso_currency_code: null,
      type: "depository",
      user_id: "user-1",
    };
    const supabase = clientStub({
      transactions: { data: [] },
    });

    const result = await loadOverviewWidgetData(supabase as never, {
      ...options,
      visible: [],
      accounts: [fakeAccount],
    });

    expect(result.ledgerStrip.account).toEqual(fakeAccount);
    expect(result.ledgerStrip.currency).toBe("USD");
  });
});
