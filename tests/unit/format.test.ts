import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  gainLossColor,
  inflowMarker,
  roundsToZero,
  titleCase,
  formatFrequency,
  formatDay,
  formatMonth,
  formatMinutesAgo,
  hoursSince,
  daysSince,
} from "@/lib/format";

describe("formatCurrency", () => {
  it("formats positive numbers as USD currency by default", () => {
    // We replace non-breaking spaces or strip formatting to be robust against locale variances
    const formatted = formatCurrency(1234.56).replace(/\s/g, " ");
    expect(formatted).toContain("$1,234.56");
  });

  it("formats negative numbers correctly", () => {
    const formatted = formatCurrency(-50).replace(/\s/g, " ");
    expect(formatted).toContain("-$50.00");
  });

  it("handles null or undefined by formatting 0", () => {
    const formattedNull = formatCurrency(null).replace(/\s/g, " ");
    expect(formattedNull).toContain("$0.00");

    const formattedUndef = formatCurrency(undefined).replace(/\s/g, " ");
    expect(formattedUndef).toContain("$0.00");
  });

  it("respects custom currency codes", () => {
    const formatted = formatCurrency(100, "EUR").replace(/\s/g, " ");
    expect(formatted).toContain("€100.00");
  });

  it("falls back to standard custom string formatting on invalid currency codes", () => {
    // If Intl throws, it should return a fallback format
    const formatted = formatCurrency(10.5, "INVALID_CURRENCY");
    expect(formatted).toBe("$10.50");
  });
});

describe("roundsToZero / neutral display zeros", () => {
  it.each([
    ["USD", 0, "$0.00"],
    ["USD", -0, "$0.00"],
    ["USD", 0.004, "$0.00"],
    ["USD", -0.004, "$0.00"],
    ["USD", 0.0045, "$0.00"],
    ["USD", -0.0045, "$0.00"],
    ["EUR", -0, "€0.00"],
    ["GBP", 0.0049, "£0.00"],
  ] as const)("normalizes %s display zero %s to %s", (currency, value, expected) => {
    expect(roundsToZero(value)).toBe(true);
    expect(formatCurrency(value, currency)).toBe(expected);
    expect(formatCurrency(value, currency)).not.toContain("-");
    expect(formatCurrency(value, currency)).not.toContain("+");
  });

  it.each([
    ["USD", 0.005, "$0.01"],
    ["USD", -0.005, "-$0.01"],
  ] as const)(
    "keeps sign and direction for %s values that round to a non-zero cent",
    (currency, value, expected) => {
      expect(roundsToZero(value)).toBe(false);
      expect(formatCurrency(value, currency)).toBe(expected);
    },
  );

  it("treats null and undefined as display zeros", () => {
    expect(roundsToZero(null)).toBe(true);
    expect(roundsToZero(undefined)).toBe(true);
    expect(formatCurrency(undefined)).toBe("$0.00");
  });

  it("does not treat large values as zeros", () => {
    expect(roundsToZero(1)).toBe(false);
    expect(roundsToZero(-1)).toBe(false);
    expect(roundsToZero(0.01)).toBe(false);
    expect(roundsToZero(-0.01)).toBe(false);
  });
});

describe("inflowMarker / gainLossColor", () => {
  it("marks only a real gain", () => {
    expect(inflowMarker(12.34)).toBe("+");
    expect(inflowMarker(-12.34)).toBe("");
    expect(inflowMarker(0)).toBe("");
    expect(inflowMarker(-0.004)).toBe("");
  });

  it("colours a gain, a loss, and nothing for a display zero", () => {
    expect(gainLossColor(1)).toBe("var(--viz-pos)");
    expect(gainLossColor(-1)).toBe("var(--viz-neg)");
    expect(gainLossColor(0)).toBeUndefined();
    expect(gainLossColor(0.004)).toBeUndefined();
  });
});

describe("titleCase", () => {
  it("returns empty string for null, undefined, or empty string", () => {
    expect(titleCase(null)).toBe("");
    expect(titleCase(undefined)).toBe("");
    expect(titleCase("")).toBe("");
  });

  it("converts a single word to title case", () => {
    expect(titleCase("hello")).toBe("Hello");
    expect(titleCase("WORLD")).toBe("World");
  });

  it("converts multiple space-separated words", () => {
    expect(titleCase("hello world")).toBe("Hello World");
    expect(titleCase("HELLO   WORLD")).toBe("Hello World");
  });

  it("converts snake_case words to space-separated title case", () => {
    expect(titleCase("FOOD_AND_DRINK")).toBe("Food And Drink");
    expect(titleCase("some_random_category_name")).toBe("Some Random Category Name");
  });

  it("handles a mix of spaces and underscores", () => {
    expect(titleCase("some_random  name")).toBe("Some Random Name");
  });
});

describe("formatFrequency", () => {
  it("humanizes known Plaid frequencies", () => {
    expect(formatFrequency("MONTHLY")).toBe("Monthly");
    expect(formatFrequency("ANNUALLY")).toBe("Annually");
    expect(formatFrequency("SEMI_MONTHLY")).toBe("Semi Monthly");
  });

  it("collapses UNKNOWN, null, undefined, and blanks to \"Recurring\"", () => {
    expect(formatFrequency("UNKNOWN")).toBe("Recurring");
    expect(formatFrequency(null)).toBe("Recurring");
    expect(formatFrequency(undefined)).toBe("Recurring");
    expect(formatFrequency("   ")).toBe("Recurring");
  });
});

describe("formatMonth", () => {
  it("formats YYYY-MM keys to MMM YYYY display format", () => {
    expect(formatMonth("2026-06")).toBe("Jun 2026");
    expect(formatMonth("2020-01")).toBe("Jan 2020");
    expect(formatMonth("2025-12")).toBe("Dec 2025");
  });
});

describe("formatDay", () => {
  it("formats YYYY-MM-DD dates to a short month + day", () => {
    expect(formatDay("2026-07-24")).toBe("Jul 24");
    expect(formatDay("2025-12-01")).toBe("Dec 1");
  });
});

describe("formatMinutesAgo", () => {
  it("covers the minute/hour/day ladder", () => {
    expect(formatMinutesAgo(0)).toBe("just now");
    expect(formatMinutesAgo(12)).toBe("12m ago");
    expect(formatMinutesAgo(95)).toBe("1h ago");
    expect(formatMinutesAgo(60 * 24 * 3 + 30)).toBe("3d ago");
  });

  it('returns "never" for null/undefined/negative', () => {
    expect(formatMinutesAgo(null)).toBe("never");
    expect(formatMinutesAgo(undefined)).toBe("never");
    expect(formatMinutesAgo(-5)).toBe("never");
  });
});

describe("hoursSince and daysSince", () => {
  it("calculates hoursSince and daysSince correctly", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();

    expect(hoursSince(twoHoursAgo)).toBe(2);
    expect(hoursSince(null)).toBeNull();

    expect(daysSince(threeDaysAgo)).toBe(3);
    expect(daysSince(null)).toBeNull();
  });
});
