/**
 * Pure math behind the per-account reconcile workflow (features.md #2).
 *
 * Sign convention: transactions carry Plaid's sign (positive = money out of
 * the account). `direction` mirrors lib/sync-health.ts: 1 for liability
 * accounts (spending increases what you owe), −1 for assets. Cleared and
 * outstanding sums are direction-adjusted, so they read as balance changes.
 *
 * The book balance is the account's current ledger balance (provider balance
 * for Plaid accounts, the stored balance for manual ones). The difference is
 * book − statement; a nonzero difference is not an error, it is the signal
 * that some transaction is missing, duplicated, or mis-dated — the workflow's
 * job is to make it attributable.
 */

export interface ReconcileTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number; // Plaid sign: positive = out
  cleared: boolean;
  merchant: string;
}

export interface ReconcileInput {
  direction: 1 | -1;
  /** The account's current book balance. */
  bookBalance: number;
  /** The statement's ending balance, entered by the user. */
  statementBalance: number;
  /** The statement's ending date; transactions after it are out of scope. */
  statementDate: string;
  transactions: readonly ReconcileTransaction[];
}

export interface ReconcileResult {
  /** Direction-adjusted sum of cleared transactions on or before the statement date. */
  clearedTotal: number;
  /** Direction-adjusted sum of outstanding (uncleared) transactions on or before the statement date. */
  outstandingTotal: number;
  /** bookBalance − statementBalance. */
  difference: number;
  /** Counts of cleared / outstanding in-scope transactions. */
  clearedCount: number;
  outstandingCount: number;
  balanced: boolean;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeReconciliation(input: ReconcileInput): ReconcileResult {
  let clearedTotal = 0;
  let outstandingTotal = 0;
  let clearedCount = 0;
  let outstandingCount = 0;

  for (const txn of input.transactions) {
    if (txn.date > input.statementDate) continue;
    // Asset (direction −1): a charge (positive) lowers the balance.
    // Liability (direction 1): a charge raises what you owe.
    const delta = input.direction * txn.amount;
    if (txn.cleared) {
      clearedTotal += delta;
      clearedCount += 1;
    } else {
      outstandingTotal += delta;
      outstandingCount += 1;
    }
  }

  const difference = round2(input.bookBalance - input.statementBalance);
  return {
    clearedTotal: round2(clearedTotal),
    outstandingTotal: round2(outstandingTotal),
    difference,
    clearedCount,
    outstandingCount,
    balanced: Math.abs(difference) < 0.005,
  };
}

export function parseAccountRef(
  value: unknown,
): { source: "plaid" | "manual"; id: string } | null {
  if (typeof value !== "string") return null;
  const [source, id] = value.split(":");
  if ((source === "plaid" || source === "manual") && id) return { source, id };
  return null;
}
