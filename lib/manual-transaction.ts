/**
 * Phase 12: manual ledger entries for anything Plaid doesn't cover — cash,
 * a private loan, a one-off record from before a bank was linked. Stored
 * with `plaid_transaction_id = manual-<uuid>`; the `manual-` prefix parallels
 * the existing `import-` convention (lib/import.ts) so the sync overlap
 * guard and lib/finance-domain.ts's provenance parsing skip these rows the
 * same way they already skip imports.
 */

export interface ManualTxnAccountRef {
  source: "plaid" | "manual";
  id: string;
}

export interface ManualTxnInput {
  kind: "debit" | "credit";
  amount: number;
  merchant: string;
  date: string; // YYYY-MM-DD, not in the future
  account: ManualTxnAccountRef;
  category: string | null;
  goalId: string | null;
  notes: string | null;
}

export type ManualTxnResult =
  | { ok: true; value: ManualTxnInput & { signedAmount: number } }
  | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 1_000_000;

function validAccount(
  account: { source?: unknown; id?: unknown } | undefined,
): account is { source: "plaid" | "manual"; id: string } {
  return Boolean(
    account &&
      (account.source === "plaid" || account.source === "manual") &&
      typeof account.id === "string" &&
      account.id,
  );
}

/**
 * Validates a manual ledger entry and resolves its stored sign: a debit
 * (money out) is positive, a credit (money in) is negative, matching Plaid's
 * convention throughout the rest of the app.
 */
export function normalizeManualTxn(body: unknown, today: string): ManualTxnResult {
  const b = (body ?? {}) as Record<string, unknown>;

  if (b.kind !== "debit" && b.kind !== "credit") {
    return { ok: false, error: "kind must be 'debit' or 'credit'" };
  }

  const amount = b.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return { ok: false, error: `amount must be a positive number up to ${MAX_AMOUNT}` };
  }

  const merchant = typeof b.merchant === "string" ? b.merchant.trim() : "";
  if (!merchant || merchant.length > 120) {
    return { ok: false, error: "merchant must be between 1 and 120 characters" };
  }

  const date = b.date;
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return { ok: false, error: "date must be a YYYY-MM-DD date" };
  }
  if (date > today) {
    return { ok: false, error: "date cannot be in the future" };
  }

  const account = b.account as { source?: unknown; id?: unknown } | undefined;
  if (!validAccount(account)) {
    return { ok: false, error: "account must reference a plaid or manual account id" };
  }

  const category =
    typeof b.category === "string" && b.category.trim().length > 0 ? b.category.trim() : null;

  const goalId = typeof b.goalId === "string" && b.goalId.length > 0 ? b.goalId : null;

  const notes =
    typeof b.notes === "string" && b.notes.trim().length > 0 ? b.notes.trim().slice(0, 500) : null;

  const signedAmount = b.kind === "debit" ? amount : -amount;

  return {
    ok: true,
    value: {
      kind: b.kind,
      amount,
      merchant,
      date,
      account: { source: account.source, id: account.id },
      category,
      goalId,
      notes,
      signedAmount,
    },
  };
}
