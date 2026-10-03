import { describe, expect, it } from "vitest";
import { computeBudgetAllowance } from "@/lib/budget-allowance";
const input = {
  today: "2028-02-28",
  limits: [100, 50.25],
  spent: 50.2,
  nextPayday: "2028-03-01",
};
describe("monthly budget pace", () => {
  it("uses leap-year days including today, rounds down, and labels payday separately", () => {
    expect(computeBudgetAllowance(input)).toEqual({
      budget: 150.25,
      spent: 50.2,
      left: 100.05,
      daily: 50.02,
      daysLeft: 2,
      monthEnd: "2028-02-29",
      nextPayday: "2028-03-01",
      daysUntilPayday: 2,
    });
  });
  it("leaves the whole balance for the last day and nets refunds", () => {
    expect(
      computeBudgetAllowance({
        ...input,
        today: "2026-04-30",
        spent: -10,
        nextPayday: null,
      }),
    ).toMatchObject({ daily: 160.25, daysLeft: 1, daysUntilPayday: null });
  });
  it("shows overspending, zero limits, and missing budgets honestly", () => {
    expect(
      computeBudgetAllowance({ ...input, limits: [0], spent: 10 }),
    ).toMatchObject({ daily: -5, left: -10 });
    expect(computeBudgetAllowance({ ...input, limits: [] })).toBeNull();
  });
  it.each([null, "bad", "2028-02-27"])(
    "ignores unavailable or expired payday %s without changing the allowance",
    (nextPayday) => {
      expect(computeBudgetAllowance({ ...input, nextPayday })).toMatchObject({
        daily: 50.02,
        nextPayday: null,
        daysUntilPayday: null,
      });
    },
  );
  it("refuses malformed dates and nonfinite or unsafe money", () => {
    expect(() =>
      computeBudgetAllowance({ ...input, today: "2026-02-29" }),
    ).toThrow(RangeError);
    for (const spent of [Infinity, Number.NaN, 1e13])
      expect(() => computeBudgetAllowance({ ...input, spent })).toThrow(
        RangeError,
      );
  });
});
