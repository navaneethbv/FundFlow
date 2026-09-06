import { describe, expect, it } from "vitest";
import { addDays, addMonths, advanceFrequency, isoDate, parseDate } from "@/lib/date-utils";

describe("date-utils", () => {
  it("parses and formats ISO dates", () => {
    const d = parseDate("2026-09-02");
    expect(isoDate(d)).toBe("2026-09-02");
  });

  it("adds days and months", () => {
    expect(addDays("2026-09-02", 5)).toBe("2026-09-07");
    expect(addMonths("2026-09-02", 1)).toBe("2026-10-02");
  });

  it("clamps month-end dates correctly without overflow", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    // Leap year test (2024 was leap year)
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });


  it("advances across all recurrence frequencies", () => {
    expect(advanceFrequency("2026-09-01", "weekly")).toBe("2026-09-08");
    expect(advanceFrequency("2026-09-01", "biweekly")).toBe("2026-09-15");
    expect(advanceFrequency("2026-09-01", "monthly")).toBe("2026-10-01");
    expect(advanceFrequency("2026-09-01", "quarterly")).toBe("2026-12-01");
    expect(advanceFrequency("2026-09-01", "yearly")).toBe("2027-09-01");
  });
});
