import { describe, it, expect } from "vitest";
import {
  paydayDates,
  parsePaydaySettings,
  type PaydaySettings,
} from "@/lib/payday";
import { planPaychecks } from "@/lib/paycheck-planner";
const settings: PaydaySettings = {
  cadence: "weekly",
  anchorDate: "2026-10-05",
  amount: 100,
  day1: 5,
  day2: null,
};
const bill = (id: string, dueDate: string, amount: number) => ({
  id,
  name: id,
  dueDate,
  amount,
});
describe("confirmed paydays", () => {
  it("keeps monthly end dates across leap February without drift", () => {
    expect(
      paydayDates(
        { ...settings, cadence: "monthly", anchorDate: "2028-01-31", day1: 31 },
        "2028-01-31",
      ),
    ).toEqual(["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"]);
  });
  it("deduplicates semimonthly dates clamped to February and respects the anchor", () => {
    expect(
      paydayDates(
        {
          ...settings,
          cadence: "semimonthly",
          anchorDate: "2028-02-28",
          day1: 30,
          day2: 31,
        },
        "2028-02-01",
      ),
    ).toEqual(["2028-02-29", "2028-03-30", "2028-03-31", "2028-04-30"]);
  });
  it("advances an old weekly or biweekly anchor without an unbounded catchup loop", () => {
    expect(paydayDates(settings, "2026-10-06", 2)).toEqual([
      "2026-10-12",
      "2026-10-19",
    ]);
    expect(
      paydayDates({ ...settings, cadence: "biweekly" }, "2026-10-06", 2),
    ).toEqual(["2026-10-19", "2026-11-02"]);
  });
  it.each([
    null,
    [],
    {},
    { ...settings, cadence: "guess" },
    { ...settings, amount: -1 },
    { ...settings, amount: 1.005 },
    { ...settings, anchorDate: "2026-02-30" },
    { ...settings, day1: 32 },
    { ...settings, cadence: "semimonthly", day2: 5 },
  ])("rejects invalid configuration %j", (input) => {
    expect(parsePaydaySettings(input)).toBeNull();
  });
  it("rejects invalid planning dates and counts", () => {
    expect(() => paydayDates(settings, "bad")).toThrow();
    expect(() => paydayDates(settings, "2026-10-01", 13)).toThrow();
  });
});
describe("paycheck funding", () => {
  it("judges the bridge by known cash, never by missing income", () => {
    const input = {
      today: "2026-10-01",
      settings,
      bills: [bill("rent", "2026-10-03", 50)],
    };
    expect(planPaychecks({ ...input, cash: 80 })[0]).toMatchObject({
      bridge: true,
      remaining: 30,
      shortfall: 0,
    });
    expect(planPaychecks({ ...input, cash: 20 })[0]).toMatchObject({
      remaining: -30,
      shortfall: 30,
    });
    expect(planPaychecks({ ...input, cash: null })[0]).toMatchObject({
      remaining: null,
      shortfall: null,
    });
  });
  it("funds due-day bills from that paycheck and excludes the fourth pay period", () => {
    const plan = planPaychecks({
      today: "2026-10-05",
      settings,
      cash: null,
      bills: [
        bill("today", "2026-10-05", 12.34),
        bill("later", "2026-10-26", 99),
      ],
    });
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({
      bridge: false,
      due: 12.34,
      remaining: 87.66,
    });
    expect(plan.reduce((sum, period) => sum + period.due, 0)).toBe(12.34);
  });
  it("reserves larger bills from prior paychecks without charging the bill twice", () => {
    const plan = planPaychecks({
      today: "2026-10-01",
      settings,
      cash: 500,
      bills: [
        bill("small", "2026-10-06", 40),
        bill("large", "2026-10-20", 250),
      ],
    });
    expect(plan.map((p) => p.reserved)).toEqual([0, 50, 100, 0]);
    expect(plan.map((p) => p.remaining)).toEqual([500, 10, 0, 0]);
    expect(plan[3]!.bills[0]).toMatchObject({ amount: 250, funded: 100 });
    expect(
      plan.reduce((sum, period) => sum + period.fundedDue + period.reserved, 0),
    ).toBe(290);
  });
  it("surfaces excess obligations in the earliest paycheck, not a fake bridge shortfall", () => {
    const plan = planPaychecks({
      today: "2026-10-01",
      settings,
      cash: null,
      bills: [bill("large", "2026-10-20", 400)],
    });
    expect(plan[0]!.shortfall).toBeNull();
    expect(plan[1]!.shortfall).toBe(100);
  });
  it("places overdue obligations in the current window", () => {
    expect(
      planPaychecks({
        today: "2026-10-05",
        settings,
        cash: 0,
        bills: [bill("late", "2026-09-30", 120)],
      })[0]!.remaining,
    ).toBe(-20);
  });
  it.each(
    [
      [bill("same", "2026-10-06", 2), bill("same", "2026-10-06", 2)],
      [bill("bad", "bad", 2)],
      [bill("bad", "2026-10-06", -1)],
      [bill("bad", "2026-10-06", Number.NaN)],
    ].map((bills) => ({ bills })),
  )("rejects invalid bill inputs", ({ bills }) => {
    expect(() =>
      planPaychecks({ today: "2026-10-01", settings, cash: null, bills }),
    ).toThrow();
  });
});
