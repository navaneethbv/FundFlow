export type BalanceKind = "asset" | "liability";

/**
 * Identifies whether an account type/subtype is inherently a liability (credit,
 * loan, debt, mortgage) or an asset (checking, savings, investment, cash).
 */
export function isLiabilityAccount(
  type: string | null | undefined,
  subtype?: string | null | undefined,
): boolean {
  const normalizedType = type?.toLowerCase().trim() ?? "";
  const normalizedSubtype = subtype?.toLowerCase().trim() ?? "";
  return (
    normalizedType === "credit" ||
    normalizedType === "loan" ||
    normalizedType === "debt" ||
    normalizedType === "liability" ||
    normalizedSubtype.includes("credit card") ||
    normalizedSubtype.includes("loan") ||
    normalizedSubtype.includes("mortgage") ||
    normalizedSubtype.includes("student")
  );
}

/**
 * Calculates the exact signed net-worth contribution of an account.
 * An asset contributes its balance directly (+balance).
 * A liability contributes the negative of its balance (-balance).
 * For example, a credit card with balance -$2.11 contributes +$2.11 to net worth.
 */
export function netWorthContribution(
  balance: number | null | undefined,
  type: string | null | undefined,
  subtype?: string | null | undefined,
): number {
  if (balance === null || balance === undefined || Number.isNaN(balance)) {
    return 0;
  }
  return isLiabilityAccount(type, subtype) ? -balance : balance;
}

/**
 * Classifies an account balance into the balance sheet as an asset magnitude or
 * a liability magnitude.
 *
 * - A positive credit card balance is a liability of that amount.
 * - A negative credit card balance (-$2.11) is an asset credit of $2.11.
 * - A positive checking balance is an asset of that amount.
 * - A negative checking balance (-$50) is an overdraft liability of $50.
 */
export function classifyBalanceSheetAmount(
  balance: number | null | undefined,
  type: string | null | undefined,
  subtype?: string | null | undefined,
): { kind: BalanceKind; amount: number } {
  if (balance === null || balance === undefined || Number.isNaN(balance)) {
    return {
      kind: isLiabilityAccount(type, subtype) ? "liability" : "asset",
      amount: 0,
    };
  }
  const isLiability = isLiabilityAccount(type, subtype);
  if (isLiability) {
    if (balance >= 0) {
      return { kind: "liability", amount: balance };
    }
    return { kind: "asset", amount: Math.abs(balance) };
  }
  if (balance >= 0) {
    return { kind: "asset", amount: balance };
  }
  return { kind: "liability", amount: Math.abs(balance) };
}
