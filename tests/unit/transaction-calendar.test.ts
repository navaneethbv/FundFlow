import { describe, expect, it } from "vitest";
import { buildCalendarDays } from "@/lib/transaction-calendar";

describe("transaction calendar", () => {
  it("builds a day for every date and ignores refunds", () => {
    const days = buildCalendarDays("2026-02", [
      { id: "1", date: "2026-02-01", amount: 10, merchant: "Shop" },
      { id: "2", date: "2026-02-01", amount: -3, merchant: "Refund" },
      { id: "3", date: "2026-02-28", amount: 20, merchant: "Rent" },
    ]);
    expect(days).toHaveLength(28);
    expect(days[0]).toMatchObject({ total: 10, count: 1, intensity: 4 });
    expect(days[27]).toMatchObject({ total: 20, count: 1, intensity: 7 });
  });

  it("uses zero intensity for a month with no positive outflow", () => {
    const days = buildCalendarDays("2026-01", [{ id: "refund", date: "2026-01-01", amount: -10, merchant: "Refund" }]);
    expect(days).toHaveLength(31);
    expect(days[0]).toMatchObject({ total: 0, count: 0, intensity: 0 });
  });
});
