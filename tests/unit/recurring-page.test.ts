import { describe, expect, it } from "vitest";
import { occurrenceDatesInWindow } from "@/lib/recurring-page";

describe("occurrenceDatesInWindow", () => {
  it("returns every weekly occurrence anchored ahead of the window", () => {
    const dates = occurrenceDatesInWindow(
      "2026-08-05",
      { unit: "days", amount: 7 },
      "2026-07-01",
      "2026-08-01",
    );
    expect(dates).toEqual(["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"]);
  });

  it("returns one monthly occurrence for the anchor's own month", () => {
    const dates = occurrenceDatesInWindow(
      "2026-07-15",
      { unit: "months", amount: 1 },
      "2026-07-01",
      "2026-08-01",
    );
    expect(dates).toEqual(["2026-07-15"]);
  });

  it("returns no annual occurrence for a month that isn't the anniversary month", () => {
    const dates = occurrenceDatesInWindow(
      "2026-03-01",
      { unit: "months", amount: 12 },
      "2026-07-01",
      "2026-08-01",
    );
    expect(dates).toEqual([]);
  });

  it("steps a semi-monthly cadence every 15 days across a 31-day month", () => {
    const dates = occurrenceDatesInWindow(
      "2026-07-01",
      { unit: "days", amount: 15 },
      "2026-07-01",
      "2026-08-01",
    );
    // A fixed 15-day step from day 1 lands on 1, 16, 31 within a 31-day
    // month -- three occurrences, not the "twice a month" a real
    // day-of-month-anchored semi-monthly schedule would give. This is the
    // documented approximation (see FREQUENCY_LABELS below): Plaid doesn't
    // give us a day-of-month anchor beyond first_date/last_date, so this
    // step size is an approximation, not an exact twice-monthly match.
    expect(dates).toEqual(["2026-07-01", "2026-07-16", "2026-07-31"]);
  });

  it("carries a leap-day monthly anchor across February without throwing", () => {
    const dates = occurrenceDatesInWindow(
      "2028-01-29",
      { unit: "months", amount: 1 },
      "2028-02-01",
      "2028-03-01",
    );
    // JS month-stepping on a day-of-month past the target month's length
    // rolls into the following month (2028 is a leap year: Jan 29 + 1 month
    // lands on Feb 29, which does exist). This is a real date, not a bug.
    expect(dates).toEqual(["2028-02-29"]);
  });
});
