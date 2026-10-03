import { describe, expect, it } from "vitest";
import { detectConfirmedPriceChange } from "@/lib/recurring-price-changes";

describe("confirmed recurring price changes", () => {
  it("requires two matching latest payments and a prior baseline", () => {
    expect(detectConfirmedPriceChange([
      { date: "2026-01-01", amount: 10 },
      { date: "2026-02-01", amount: 12 },
      { date: "2026-03-01", amount: 12 },
    ])).toEqual({ effectiveDate: "2026-02-01", previousAmount: 10, newAmount: 12 });
    expect(detectConfirmedPriceChange([
      { date: "2026-01-01", amount: 10 },
      { date: "2026-02-01", amount: 12 },
      { date: "2026-03-01", amount: 13 },
    ])).toBeNull();
  });

  it("rejects decreases, invalid rows, and short history", () => {
    expect(detectConfirmedPriceChange([{ date: "2026-01-01", amount: 10 }])).toBeNull();
    expect(detectConfirmedPriceChange([
      { date: "bad", amount: 10 },
      { date: "2026-02-01", amount: 9 },
      { date: "2026-03-01", amount: 9 },
    ])).toBeNull();
  });
});
