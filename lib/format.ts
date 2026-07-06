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

export function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, 1);
  return date.toLocaleString("en-US", { month: "short", year: "numeric" });
}
