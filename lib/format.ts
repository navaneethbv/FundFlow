export function formatCurrency(
  amount: number | null | undefined,
  currency = "USD",
): string {
  const value = amount ?? 0;
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
