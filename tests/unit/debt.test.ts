import { describe, expect, it } from "vitest";
import { buildPayoffPlan } from "@/lib/debt";

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
