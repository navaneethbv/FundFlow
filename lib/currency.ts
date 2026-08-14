import { formatCurrency } from "@/lib/format";

/**
 * Supported major currencies and standard reference rates relative to USD (1.0 USD base).
 */
export const SUPPORTED_CURRENCIES: Record<
  string,
  { name: string; symbol: string; decimals: number }
> = {
  USD: { name: "US Dollar", symbol: "$", decimals: 2 },
  EUR: { name: "Euro", symbol: "€", decimals: 2 },
  GBP: { name: "British Pound", symbol: "£", decimals: 2 },
  CAD: { name: "Canadian Dollar", symbol: "CA$", decimals: 2 },
  AUD: { name: "Australian Dollar", symbol: "A$", decimals: 2 },
  JPY: { name: "Japanese Yen", symbol: "¥", decimals: 0 },
  CHF: { name: "Swiss Franc", symbol: "CHF", decimals: 2 },
  INR: { name: "Indian Rupee", symbol: "₹", decimals: 2 },
  SGD: { name: "Singapore Dollar", symbol: "S$", decimals: 2 },
  NZD: { name: "New Zealand Dollar", symbol: "NZ$", decimals: 2 },
};

/** Default reference rates (units per 1 USD) */
export const DEFAULT_EXCHANGE_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  AUD: 1.52,
  JPY: 155.0,
  CHF: 0.9,
  INR: 83.5,
  SGD: 1.35,
  NZD: 1.64,
};

/**
 * Returns the currency symbol for an ISO code, falling back to "$" if unknown.
 */
export function getCurrencySymbol(currencyCode: string): string {
  const code = currencyCode.toUpperCase();
  return SUPPORTED_CURRENCIES[code]?.symbol ?? "$";
}

/**
 * Converts an amount from one currency to another using the provided or default exchange rates.
 */
export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: Record<string, number> = DEFAULT_EXCHANGE_RATES,
): number {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();

  if (from === to) return amount;

  const fromRate = rates[from] ?? 1.0;
  const toRate = rates[to] ?? 1.0;

  // Convert to USD base, then to target currency
  const inUsd = amount / fromRate;
  const converted = inUsd * toRate;

  return Math.round(converted * 100) / 100;
}

/**
 * Formats a native amount alongside its converted target display currency when they differ.
 */
export function formatMoneyWithFx(
  amount: number,
  nativeCurrency = "USD",
  displayCurrency = "USD",
  rates: Record<string, number> = DEFAULT_EXCHANGE_RATES,
): {
  formattedNative: string;
  formattedDisplay: string;
  isConverted: boolean;
} {
  const native = nativeCurrency.toUpperCase();
  const display = displayCurrency.toUpperCase();

  const formattedNative = formatCurrency(amount, native);

  if (native === display) {
    return {
      formattedNative,
      formattedDisplay: formattedNative,
      isConverted: false,
    };
  }

  const convertedAmount = convertCurrency(amount, native, display, rates);
  const formattedDisplay = formatCurrency(convertedAmount, display);

  return {
    formattedNative,
    formattedDisplay,
    isConverted: true,
  };
}
