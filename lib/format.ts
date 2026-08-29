/**
 * Bucket label for rows whose currency cannot be resolved at all. Callers pass
 * it where an ISO code goes, and it renders as a bare number rather than
 * guessing a symbol. A merely malformed code still falls back to `$` below.
 */
export const UNKNOWN_CURRENCY = "Unknown currency";

/**
 * True when `value` renders as `0.00` at the display precision — the single
 * shared rule that stops `-0`, `0.004`, and `-0.004` from wearing a direction
 * sign or colour they do not have.
 *
 * Rounding matches Intl's half-away-from-zero default: `0.005` and `-0.005`
 * round to one cent and keep their sign and direction, while anything whose
 * absolute scaled value is below half a cent is a display zero.
 */
export function roundsToZero(
  value: number | null | undefined,
  decimals = 2,
): boolean {
  const number = value ?? 0;
  const scale = 10 ** decimals;
  return Math.floor(Math.abs(number * scale) + 0.5) === 0;
}

export function formatCurrency(
  amount: number | null | undefined,
  currency = "USD",
): string {
  // A value that rounds to zero at display precision is a neutral zero, never
  // a signed `-$0.00` — this is the one normalization every surface inherits.
  const value = roundsToZero(amount) ? 0 : (amount ?? 0);
  if (currency === UNKNOWN_CURRENCY) {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Humanizes a Plaid recurring-stream frequency ("MONTHLY" → "Monthly").
 * UNKNOWN or blank collapses to "Recurring" rather than a bare "Unknown".
 */
export function formatFrequency(frequency: string | null | undefined): string {
  const value = frequency?.trim();
  if (!value || value.toUpperCase() === "UNKNOWN") {
    return "Recurring";
  }
  return titleCase(value);
}

/** "just now" / "12m ago" / "3h ago" / "2d ago" from a minute count. */
export function formatMinutesAgo(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes < 0) return "never";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (24 * 60))}d ago`;
}

/** Whole hours elapsed since an ISO timestamp (null passes through). */
export function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
}

/** Whole days elapsed since an ISO timestamp (null passes through). */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/** "2026-07-24" → "Jul 24". */
export function formatDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(year!, (month ?? 1) - 1, day ?? 1);
  return parsed.toLocaleString("en-US", { month: "short", day: "numeric" });
}

export function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, 1);
  return date.toLocaleString("en-US", { month: "short", year: "numeric" });
}
