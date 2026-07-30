import { describe, it, expect } from "vitest";
import { budgetWindow, getMonthEndDate } from "@/lib/budget-page";

describe("Phase 4 Budget Full Parity", () => {
  it("computes correct month end dates for standard months and leap years", () => {
    expect(getMonthEndDate("2026-07")).toBe("2026-07-31");
    expect(getMonthEndDate("2026-02")).toBe("2026-02-28");
    expect(getMonthEndDate("2028-02")).toBe("2028-02-29");
  });

  it("uses calendar windows for every horizon", () => {
    expect(budgetWindow("2026-07", "yearly")).toEqual({
      start: "2026-01-01",
      endExclusive: "2027-01-01",
    });
    expect(budgetWindow("2026-07", "decade")).toEqual({
      start: "2020-01-01",
      endExclusive: "2030-01-01",
    });
  });
});
