import { describe, expect, it } from "vitest";
import { anniversaryWindow, calculateCardValue, validateCardValueTerms, type CardValueTerms } from "@/lib/card-value";

const terms: CardValueTerms = {
  id: "membership-1",
  membershipName: "Travel membership",
  cardName: "Travel card",
  annualFee: 95,
  baselineAnnualFee: 0,
  anniversaryDate: "2024-02-29",
  confirmedOn: "2026-01-01",
  rewardTiers: [{ id: "travel", label: "Travel", rate: 0.03, cap: null, eligibleCategories: ["TRAVEL"] }],
  statementCredits: [{ id: "credit", label: "Travel credit", amount: 50, eligibleCategories: ["TRAVEL"], expiresAfterMonths: 12 }],
  perks: [{ id: "lounge", label: "Lounge access", low: 0, base: 25, high: 75, membershipOnly: true }],
};

describe("card value", () => {
  it("uses anniversary years and clamps leap-day anniversaries", () => {
    expect(anniversaryWindow("2024-02-29", "2026-02-27")).toEqual({ start: "2025-02-28", end: "2026-02-28" });
    expect(() => anniversaryWindow("bad", "2026-02-27")).toThrow("anniversary dates must be ISO dates");
  });

  it("handles uncategorized rows, capped reward tiers, and a complete year", () => {
    const result = calculateCardValue({
      terms: {
        ...terms,
        rewardTiers: [
          { id: "base", label: "Base", rate: 0.01, cap: 50, eligibleCategories: [] },
          { id: "bonus", label: "Bonus", rate: 0.02, cap: null, eligibleCategories: ["TRAVEL"] },
        ],
        statementCredits: [],
        perks: [],
      },
      asOf: "2026-02-27",
      spend: [
        { date: "2025-02-28", amount: 50, category: null, flow: "expense" },
        { date: "2026-02-27", amount: 100, category: "TRAVEL", flow: "expense" },
      ],
    });
    expect(result.historyCoverage).toBeGreaterThan(0.99);
    expect(result.projectedRewards).toBe(0);
    expect(result.measuredRewards).toBe(2.5);
  });

  it("returns no break-even spend when rewards have no rate", () => {
    const result = calculateCardValue({
      terms: { ...terms, rewardTiers: [{ ...terms.rewardTiers[0]!, rate: 0 }] },
      asOf: "2026-03-01",
      spend: [],
    });
    expect(result.breakEvenSpend).toBeNull();
  });

  it("nets refunds and excludes transfers from eligible spend", () => {
    const result = calculateCardValue({
      terms,
      asOf: "2026-03-10",
      spend: [
        { date: "2026-03-01", amount: 1_000, category: "TRAVEL", flow: "expense" },
        { date: "2026-03-02", amount: -200, category: "TRAVEL", flow: "expense", isRefund: true },
        { date: "2026-03-03", amount: 900, category: "TRANSFER_OUT", flow: "transfer" },
      ],
    });
    expect(result.eligibleSpend).toBe(800);
    expect(result.measuredRewards).toBe(24);
    expect(result.statementCredits).toBe(50);
    expect(result.subjectivePerks.base).toBe(25);
    expect(result.breakEvenSpend).toBeGreaterThan(0);
  });

  it("labels incomplete history through a non-zero projection", () => {
    const result = calculateCardValue({
      terms,
      asOf: "2026-03-01",
      spend: [{ date: "2026-02-28", amount: 100, category: "TRAVEL", flow: "expense" }],
    });
    expect(result.historyCoverage).toBeLessThan(1);
    expect(result.projectedRewards).toBeGreaterThan(0);
  });

  it("honors credit expiry and marks old terms stale", () => {
    const result = calculateCardValue({
      terms: { ...terms, confirmedOn: "2024-01-01", statementCredits: [{ ...terms.statementCredits[0]!, expiresAfterMonths: 0 }] },
      asOf: "2026-04-01",
      spend: [{ date: "2026-03-01", amount: 100, category: "TRAVEL", flow: "expense" }],
    });
    expect(result.statementCredits).toBe(0);
    expect(result.termsStale).toBe(true);
  });

  it("validates the user-authored terms envelope", () => {
    expect(validateCardValueTerms([terms]).ok).toBe(true);
    expect(validateCardValueTerms({}).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, annualFee: -1 }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, anniversaryDate: "bad" }]).ok).toBe(false);
  });

  it("rejects malformed nested benefit terms", () => {
    expect(validateCardValueTerms(Array.from({ length: 51 }, () => terms)).ok).toBe(false);
    expect(validateCardValueTerms([null]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, membershipName: " " }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, rewardTiers: [null] }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, rewardTiers: [{ ...terms.rewardTiers[0]!, rate: 2 }] }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, rewardTiers: [{ ...terms.rewardTiers[0]!, cap: "bad" }] }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, statementCredits: [null] }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, statementCredits: [{ ...terms.statementCredits[0]!, amount: -1 }] }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, perks: [null] }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, perks: [{ ...terms.perks[0]!, high: -1 }] }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, annualFee: Number.NaN }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, rewardTiers: null }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, confirmedOn: "bad" }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, statementCredits: null }]).ok).toBe(false);
    expect(validateCardValueTerms([{ ...terms, perks: null }]).ok).toBe(false);
  });

  it("normalizes optional benefit fields without inventing a catalog", () => {
    const result = validateCardValueTerms([{
      ...terms,
      rewardTiers: [{ id: "base", label: "Spend", rate: 0.01, cap: null, eligibleCategories: undefined }],
      statementCredits: [{ id: "credit", label: "Credit", amount: 10, eligibleCategories: undefined, expiresAfterMonths: undefined }],
      perks: [{ id: "perk", label: "Perk", low: 1, base: 2, high: 3, membershipOnly: false }],
    }]);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value[0]?.rewardTiers[0]?.eligibleCategories).toEqual([]);
      expect(result.value[0]?.statementCredits[0]?.expiresAfterMonths).toBeNull();
      expect(result.value[0]?.perks[0]?.membershipOnly).toBe(false);
    }
  });
});
