import { describe, it, expect } from "vitest";
import { formatCurrency, titleCase, formatMonth } from "@/lib/format";

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

describe("formatMonth", () => {
  it("formats YYYY-MM keys to MMM YYYY display format", () => {
    expect(formatMonth("2026-06")).toBe("Jun 2026");
    expect(formatMonth("2020-01")).toBe("Jan 2020");
    expect(formatMonth("2025-12")).toBe("Dec 2025");
  });
});
