import { validPaydayDate } from "@/lib/payday";
import { parseDate } from "@/lib/date-utils";

export interface QualityHolding {
  id: string;
  quantity: number | null;
  price: number | null;
  value: number | null;
}
export interface QualityReading {
  date: string;
  balance: number | null;
  currency: string;
  /** Null means holdings were not observed, which differs from an empty list. */
  holdings: QualityHolding[] | null;
}
export type BalanceQualityReason =
  "balance_jump" | "missing_balance" | "empty_holdings" | "holding_price_jump";

/** Review heuristics, never an instruction to rewrite a provider observation. */
function changedBalance(
  raw: number | null,
  previous: number | null,
): BalanceQualityReason | null {
  if (previous === null) return null;
  if (raw === null) return "missing_balance";
  const difference = Math.abs(raw - previous);
  return difference >= 1000 && difference >= Math.abs(previous)
    ? "balance_jump"
    : null;
}

function holdingPriceJump(
  current: QualityHolding,
  previous: QualityHolding | undefined,
): boolean {
  if (previous?.price == null || current.price === null || previous.price <= 0)
    return false;
  if (
    previous.value === null ||
    current.value === null ||
    Math.abs(previous.value) < 1000
  )
    return false;
  // Share splits and offsetting quantity changes can change the unit price
  // while leaving the position's value nearly unchanged.
  const valueChange = Math.abs(current.value - previous.value);
  if (valueChange <= Math.max(1, Math.abs(previous.value) * 0.02)) return false;
  return Math.abs(current.price - previous.price) / previous.price >= 0.5;
}

function holdingReasons(
  current: QualityHolding[] | null,
  previous: QualityHolding[] | null,
): BalanceQualityReason[] {
  if (current === null || previous === null) return [];
  if (
    current.length === 0 &&
    previous.some((row) => Math.abs(row.value ?? 0) >= 1000)
  )
    return ["empty_holdings"];
  const byId = new Map(previous.map((row) => [row.id, row]));
  return current.some((row) => holdingPriceJump(row, byId.get(row.id)))
    ? ["holding_price_jump"]
    : [];
}

/**
 * Compare only recent same-currency observations. An absent, older, or future
 * anchor does not establish that a reading is suspicious or that zero is safe.
 * Genuine market changes may trigger review; callers must retain the raw value.
 */
export function assessBalanceQuality(
  current: QualityReading,
  previous: QualityReading | null,
): BalanceQualityReason[] {
  if (
    !previous ||
    !validPaydayDate(current.date) ||
    !validPaydayDate(previous.date) ||
    current.currency !== previous.currency
  )
    return [];
  const elapsedDays =
    (parseDate(current.date).getTime() - parseDate(previous.date).getTime()) /
    86400000;
  if (!Number.isFinite(elapsedDays) || elapsedDays < 0 || elapsedDays > 7)
    return [];
  const balance = changedBalance(current.balance, previous.balance);
  return [
    ...(balance ? [balance] : []),
    ...holdingReasons(current.holdings, previous.holdings),
  ];
}

export const BALANCE_QUALITY_LABELS: Record<BalanceQualityReason, string> = {
  balance_jump: "Large change from the last reliable balance",
  missing_balance: "Provider did not return a balance",
  empty_holdings: "Previously reported holdings are now empty",
  holding_price_jump: "A holding's unit price changed sharply",
};
