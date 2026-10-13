import { describe, expect, it } from "vitest";
import { calculateGoalScenario, type GoalScenarioInput } from "@/lib/goal-scenarios";
const base: GoalScenarioInput = { targetAmount: 1000, fundedAmount: 100, contributionAmount: 100, lumpSum: 0, cadence: "monthly", skipPayments: 0, today: "2028-01-31", deadline: "2028-03-31" };
const calc = (overrides: Partial<GoalScenarioInput> = {}) => calculateGoalScenario({ ...base, ...overrides });
describe("savings goal scenarios", () => {
  it("anchors monthly dates and rounds required contributions upward to cents", () => {
    const result = calc();
    expect(result.paymentDates.slice(0, 3)).toEqual(["2028-02-29", "2028-03-31", "2028-04-30"]);
    expect(result.completionDate).toBe("2028-10-31");
    expect(result.deadline).toMatchObject({ status: "available", payments: 2, requiredAmount: 450, gapAmount: 350 });
    expect(calc({ targetAmount: 100, fundedAmount: 0, deadline: "2028-04-30" }).deadline?.requiredAmount).toBe(33.34);
  });
  it("supports weekly and biweekly contributions after today", () => {
    expect(calc({ cadence: "weekly" }).paymentDates[0]).toBe("2028-02-07");
    expect(calc({ cadence: "biweekly" }).paymentDates[0]).toBe("2028-02-14");
    expect(calc({ today: "2027-01-31" }).paymentDates[0]).toBe("2027-02-28");
  });
  it("applies lump sums immediately and skips only future payments", () => {
    const result = calc({ lumpSum: 400, skipPayments: 2 });
    expect(result.completionDate).toBe("2028-08-31");
    expect(result.milestones.map(m => [m.percent, m.status, m.date])).toEqual([[25, "lump-sum", "2028-01-31"], [50, "lump-sum", "2028-01-31"], [75, "projected", "2028-06-30"], [100, "projected", "2028-08-31"]]);
    expect(result.deadline?.status).toBe("no-payments");
  });
  it("handles reached milestones, complete goals and zero contributions", () => {
    expect(calc({ fundedAmount: 250 }).milestones[0].status).toBe("already-reached");
    expect(calc({ fundedAmount: 2000 }).completionDate).toBe(base.today);
    expect(calc({ targetAmount: 0, fundedAmount: 0 }).deadline?.requiredAmount).toBe(0);
    expect(calc({ contributionAmount: 0 }).completionStatus).toBe("no-contributions");
    expect(calc({ lumpSum: 1000 }).completionStatus).toBe("complete");
  });
  it("caps the horizon, including skipped dates, and refuses misleading deadline amounts", () => {
    const result = calc({ contributionAmount: 0.01, skipPayments: 120, deadline: "2090-01-01" });
    expect(result.paymentDates).toHaveLength(480);
    expect(result.completionStatus).toBe("beyond-horizon");
    expect(result.deadline?.status).toBe("beyond-horizon");
    expect(calc({ deadline: "2027-01-01" }).deadline?.status).toBe("past");
    expect(calc({ deadline: base.today }).deadline?.status).toBe("no-payments");
    expect(calc({ deadline: null }).deadline).toBeNull();
  });
  it.each([{ contributionAmount: 0.001 }, { today: "not-a-date" }, { today: "2028-99-99" }, { contributionAmount: NaN }, { lumpSum: Infinity }, { targetAmount: -1 }, { fundedAmount: -1 }, { contributionAmount: 1e15 }, { skipPayments: 121 }, { skipPayments: -1 }, { skipPayments: 0.5 }, { today: "2028-02-30" }, { deadline: "2027-02-29" }, { today: "9999-12-31" }, { cadence: "daily" }])("rejects invalid inputs %j", (input) => {
    expect(() => calc(input as Partial<GoalScenarioInput>)).toThrow();
  });
  it("rounds money once and does not mutate inputs", () => {
    expect(calc({ targetAmount: 0.3, fundedAmount: 0.1, contributionAmount: 0.1 }).completionDate).toBe("2028-03-31");
    expect(base.fundedAmount).toBe(100);
  });
});
