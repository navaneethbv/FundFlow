/**
 * Shared validation rules for manual transaction entries and scheduled transactions.
 */

export interface TransactionAccountRef {
  source: "plaid" | "manual";
  id: string;
}

export const TRANSACTION_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_TRANSACTION_AMOUNT = 1_000_000;

export function isValidTransactionAccount(
  account: { source?: unknown; id?: unknown } | undefined,
): account is TransactionAccountRef {
  return Boolean(
    account &&
      (account.source === "plaid" || account.source === "manual") &&
      typeof account.id === "string" &&
      account.id,
  );
}
