import { describe, it, expect } from "vitest";
import {
  convertCurrency,
  formatMoneyWithFx,
  getCurrencySymbol,
  SUPPORTED_CURRENCIES,
} from "@/lib/currency";

describe("lib/currency", () => {
  it("defines standard supported currencies", () => {
    expect(SUPPORTED_CURRENCIES.USD).toBeDefined();
    expect(SUPPORTED_CURRENCIES.EUR).toBeDefined();
    expect(SUPPORTED_CURRENCIES.GBP).toBeDefined();
  });

  it("resolves currency symbols correctly", () => {
    expect(getCurrencySymbol("USD")).toBe("$");
    expect(getCurrencySymbol("EUR")).toBe("€");
    expect(getCurrencySymbol("GBP")).toBe("£");
    expect(getCurrencySymbol("JPY")).toBe("¥");
    expect(getCurrencySymbol("INR")).toBe("₹");
    expect(getCurrencySymbol("XYZ")).toBe("$"); // fallback
  });

  it("converts identical currencies with no change", () => {
    expect(convertCurrency(100, "USD", "USD")).toBe(100);
    expect(convertCurrency(250.5, "EUR", "EUR")).toBe(250.5);
  });

  it("converts currencies accurately via exchange rates", () => {
    // Custom rates: USD = 1.0, EUR = 0.90, GBP = 0.80
    const customRates = { USD: 1.0, EUR: 0.9, GBP: 0.8 };

    // 100 USD -> 90 EUR
    expect(convertCurrency(100, "USD", "EUR", customRates)).toBe(90);

    // 90 EUR -> 100 USD
    expect(convertCurrency(90, "EUR", "USD", customRates)).toBe(100);

    // 90 EUR -> 80 GBP
    expect(convertCurrency(90, "EUR", "GBP", customRates)).toBe(80);
  });

  it("formats native vs converted currency nicely", () => {
    const customRates = { USD: 1.0, EUR: 0.9 };
    const same = formatMoneyWithFx(100, "USD", "USD");
    expect(same.isConverted).toBe(false);
    expect(same.formattedNative).toContain("100.00");
    expect(same.formattedDisplay).toBe(same.formattedNative);

    const diff = formatMoneyWithFx(100, "EUR", "USD", customRates);
    expect(diff.isConverted).toBe(true);
    expect(diff.formattedNative).toContain("100.00");
    expect(diff.formattedDisplay).toContain("111.11");
  });
});
