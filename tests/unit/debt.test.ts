import { describe, expect, it } from "vitest";
import { buildPayoffPlan } from "@/lib/debt";
import {
  parseDebtStrategy,
  parseExtraMonthly,
  buildDebtPlannerData,
  loadDebtPlannerData,
} from "@/lib/debt-data";

describe("buildPayoffPlan", () => {
  it("orders focus by highest APR for avalanche and smallest balance for snowball", () => {
    const debts = [
      { name: "Big Card", balance: 5000, apr: 22 },
      { name: "Small Loan", balance: 1000, apr: 5 },
    ];
    const avalanche = buildPayoffPlan({ debts, extraMonthly: 0, strategy: "avalanche" });
    const snowball = buildPayoffPlan({ debts, extraMonthly: 0, strategy: "snowball" });
    expect(avalanche?.order).toEqual(["Big Card", "Small Loan"]);
    expect(snowball?.order).toEqual(["Small Loan", "Big Card"]);
  });

  it("rolls a cleared debt's payment into the next debt", () => {
    // A clears in month 10; its $100 then joins B's payment, so B's last
    // $200 clears in month 11 instead of month 12.
    const plan = buildPayoffPlan({
      debts: [
        { name: "A", balance: 1000, apr: 0, minPayment: 100 },
        { name: "B", balance: 1200, apr: 0, minPayment: 100 },
      ],
      extraMonthly: 0,
      strategy: "avalanche",
    });
    expect(plan).not.toBeNull();
    expect(plan!.debts.find((d) => d.name === "A")?.payoffMonth).toBe(10);
    expect(plan!.debts.find((d) => d.name === "B")?.payoffMonth).toBe(11);
    expect(plan!.months).toBe(11);
    expect(plan!.totalInterest).toBe(0);
  });

  it("pays exactly the balance on a zero-APR debt", () => {
    const plan = buildPayoffPlan({
      debts: [{ name: "Zero", balance: 500, apr: 0, minPayment: 100 }],
      extraMonthly: 0,
      strategy: "avalanche",
    });
    expect(plan).toEqual({
      months: 5,
      totalInterest: 0,
      order: ["Zero"],
      debts: [{ name: "Zero", payoffMonth: 5, interestPaid: 0 }],
    });
  });

  it("accrues interest so payoff takes longer than balance / payment", () => {
    const plan = buildPayoffPlan({
      debts: [{ name: "Card", balance: 1000, apr: 12, minPayment: 100 }],
      extraMonthly: 0,
      strategy: "avalanche",
    });
    expect(plan).not.toBeNull();
    expect(plan!.months).toBeGreaterThan(10);
    expect(plan!.totalInterest).toBeGreaterThan(0);
    expect(plan!.debts[0]!.interestPaid).toBe(plan!.totalInterest);
  });

  it("directs extra payments at the focus debt first", () => {
    const plan = buildPayoffPlan({
      debts: [
        { name: "High", balance: 1000, apr: 20, minPayment: 50 },
        { name: "Low", balance: 1000, apr: 10, minPayment: 50 },
      ],
      extraMonthly: 100,
      strategy: "avalanche",
    });
    expect(plan).not.toBeNull();
    const high = plan!.debts.find((d) => d.name === "High")!;
    const low = plan!.debts.find((d) => d.name === "Low")!;
    expect(high.payoffMonth).toBeLessThan(low.payoffMonth);
  });

  it("defaults the minimum payment to max($25, 2% of balance)", () => {
    const large = buildPayoffPlan({
      debts: [{ name: "L", balance: 5000, apr: 0 }],
      extraMonthly: 0,
      strategy: "avalanche",
    });
    expect(large?.months).toBe(50); // 5000 / (2% = $100)

    const small = buildPayoffPlan({
      debts: [{ name: "S", balance: 500, apr: 0 }],
      extraMonthly: 0,
      strategy: "avalanche",
    });
    expect(small?.months).toBe(20); // 500 / ($25 floor)
  });

  it("returns null when payments cannot cover the interest", () => {
    // $200/month interest vs a $100 budget: never converges.
    expect(
      buildPayoffPlan({
        debts: [{ name: "Trap", balance: 10000, apr: 24, minPayment: 100 }],
        extraMonthly: 0,
        strategy: "avalanche",
      }),
    ).toBeNull();
  });

  it("returns null for an empty debt list", () => {
    expect(
      buildPayoffPlan({ debts: [], extraMonthly: 100, strategy: "snowball" }),
    ).toBeNull();
  });

  it("rounds interest to cents", () => {
    const plan = buildPayoffPlan({
      debts: [{ name: "C", balance: 1000, apr: 7, minPayment: 150 }],
      extraMonthly: 0,
      strategy: "avalanche",
    });
    expect(plan).not.toBeNull();
    expect(plan!.totalInterest).toBe(Math.round(plan!.totalInterest * 100) / 100);
    for (const debt of plan!.debts) {
      expect(debt.interestPaid).toBe(Math.round(debt.interestPaid * 100) / 100);
    }
  });
});

describe("parseDebtStrategy & parseExtraMonthly", () => {
  it("parses debt strategy parameters", () => {
    expect(parseDebtStrategy("snowball")).toBe("snowball");
    expect(parseDebtStrategy(["snowball", "avalanche"])).toBe("snowball");
    expect(parseDebtStrategy("avalanche")).toBe("avalanche");
    expect(parseDebtStrategy(undefined)).toBe("avalanche");
  });

  it("parses extra monthly payment parameters", () => {
    expect(parseExtraMonthly("100")).toBe(100);
    expect(parseExtraMonthly(["150.50", "200"])).toBe(150.5);
    expect(parseExtraMonthly("invalid")).toBe(0);
    expect(parseExtraMonthly(undefined)).toBe(0);
  });
});

describe("buildDebtPlannerData & loadDebtPlannerData", () => {
  it("returns zero data for empty debt list", () => {
    const data = buildDebtPlannerData([], 50);
    expect(data.debts).toEqual([]);
    expect(data.totalBalance).toBe(0);
    expect(data.totalMonthlyBudget).toBe(0);
    expect(data.avalanche).toBeNull();
    expect(data.snowball).toBeNull();
  });

  it("builds debt planner data with assumed APR when APR is null", () => {
    const data = buildDebtPlannerData(
      [
        { id: "a1", name: "Card 1", balance: -2000, apr: null },
        { id: "a2", name: "Zero Balance", balance: 0, apr: 15 },
      ],
      100,
    );
    expect(data.debts).toHaveLength(1);
    expect(data.debts[0]).toMatchObject({
      id: "a1",
      name: "Card 1",
      balance: 2000,
      apr: 22,
      aprAssumed: true,
      minimumPayment: 40,
    });
    expect(data.totalBalance).toBe(2000);
    expect(data.totalMonthlyBudget).toBe(140);
    expect(data.avalanche).not.toBeNull();
  });

  it("loads debt planner data from Supabase client", async () => {
    const { clientStub } = await import("../fixtures/supabase-query");
    const supabase = clientStub({
      accounts: {
        data: [
          { id: "a1", name: "Credit Card", type: "credit", subtype: null, current_balance: 1500, apr: 18.5 },
          { id: "a2", name: "Checking", type: "depository", subtype: null, current_balance: 5000, apr: null },
        ],
      },
    });

    const data = await loadDebtPlannerData(supabase, {
      scope: { type: "user", userId: "u1" },
      extraMonthly: 50,
    });

    expect(data.debts).toHaveLength(1);
    expect(data.debts[0].name).toBe("Credit Card");
    expect(data.debts[0].apr).toBe(18.5);
  });

  it("throws error when loadDebtPlannerData query fails", async () => {
    const { clientStub } = await import("../fixtures/supabase-query");
    const supabase = clientStub({
      accounts: { data: null, error: { message: "Permission denied", code: "42501" } },
    });

    await expect(
      loadDebtPlannerData(supabase, {
        scope: { type: "all" },
        extraMonthly: 0,
      }),
    ).rejects.toThrow("debt_accounts_query_failed:42501");
  });
});
