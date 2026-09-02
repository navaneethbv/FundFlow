/**
 * One-off scheduled (future-dated) transactions. Rows in
 * `scheduled_transactions` are commitments the ledger hasn't seen yet ("rent
 * due on the 25th"); the daily sync cron promotes due rows into
 * `transactions` and the forecast/bill calendar project them as one-off
 * events so the projected balance is honest before the money moves.
 *
 * Validation mirrors lib/manual-transaction.ts, with the future-date guard
 * inverted: a scheduled entry must be today or later, while a manual entry
 * must not be. Sign convention is Plaid's: a debit (money out) is positive.
 */

import { addDays } from "@/lib/date-utils";
import type { RecurringItem } from "@/lib/planning";

export interface ScheduledTxnAccountRef {
  source: "plaid" | "manual";
  id: string;
}

export interface ScheduledTxnInput {
  kind: "debit" | "credit";
  amount: number;
  merchant: string;
  date: string; // YYYY-MM-DD, today or later
  account: ScheduledTxnAccountRef;
  category: string | null;
  notes: string | null;
}

export type ScheduledTxnResult =
  | { ok: true; value: ScheduledTxnInput & { signedAmount: number } }
  | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 1_000_000;
/** Ten years out is a typo, not a plan. */
const MAX_HORIZON_DAYS = 3650;

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

export function normalizeScheduledTxn(body: unknown, today: string): ScheduledTxnResult {
  const b = (body ?? {}) as Record<string, unknown>;

  if (b.kind !== "debit" && b.kind !== "credit") {
    return { ok: false, error: "kind must be 'debit' or 'credit'" };
  }

  const amount = b.amount;
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > MAX_AMOUNT
  ) {
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
  // Today is allowed (the ledger hasn't seen it yet) and clients east of UTC
  // may default to a day ahead, so the floor is yesterday-equivalent UTC.
  if (date < addDays(today, -1)) {
    return { ok: false, error: "date cannot be in the past" };
  }
  if (date > addDays(today, MAX_HORIZON_DAYS)) {
    return { ok: false, error: "date cannot be more than ten years out" };
  }

  const account = b.account as { source?: unknown; id?: unknown } | undefined;
  if (!validAccount(account)) {
    return { ok: false, error: "account must reference a plaid or manual account id" };
  }

  const category =
    typeof b.category === "string" && b.category.trim().length > 0
      ? b.category.trim().slice(0, 120)
      : null;

  const notes =
    typeof b.notes === "string" && b.notes.trim().length > 0
      ? b.notes.trim().slice(0, 500)
      : null;

  const signedAmount = b.kind === "debit" ? amount : -amount;

  return {
    ok: true,
    value: { kind: b.kind, amount, merchant, date, account, category, notes, signedAmount },
  };
}

/**
 * Deterministic provenance id for the promoted ledger row: the schedule's own
 * uuid is stable, so promotion (and any re-run) upserts onto the same row.
 * The `scheduled-` prefix parallels `import-` and `manual-` and is skipped by
 * the sync overlap guard the same way.
 */
export function scheduledPlaidTxnId(scheduledId: string): string {
  return `scheduled-${scheduledId}`;
}

/** The transactions row a due schedule promotes into. */
export function toPromotedTransactionRow(
  userId: string,
  row: {
    id: string;
    kind: string;
    amount: number | string;
    merchant: string;
    scheduled_date: string;
    category: string | null;
    account_id: string | null;
    manual_account_id: string | null;
  },
): Record<string, unknown> {
  const amount = Number(row.amount);
  return {
    user_id: userId,
    account_id: row.account_id,
    manual_account_id: row.manual_account_id,
    plaid_transaction_id: scheduledPlaidTxnId(row.id),
    amount: row.kind === "debit" ? Math.abs(amount) : -Math.abs(amount),
    date: row.scheduled_date,
    name: row.merchant,
    merchant_name: row.merchant,
    pfc_primary: row.category,
    source: "manual",
    pending: false,
  };
}

/** A schedule is due once its date has arrived (server UTC date). */
export function isDue(row: { status: string; scheduled_date: string }, today: string): boolean {
  return row.status === "scheduled" && row.scheduled_date <= today;
}

/**
 * Project a schedule into the forecast/bill-calendar item shape. `frequency:
 * "once"` fires exactly once on its date — never repeats.
 */
export function toRecurringItem(row: {
  kind: string;
  amount: number | string;
  merchant: string;
  scheduled_date: string;
  category: string | null;
}): RecurringItem {
  const amount = Number(row.amount);
  return {
    name: row.merchant,
    amount: Math.abs(amount),
    itemType: row.kind === "debit" ? "expense" : "income",
    frequency: "once",
    nextDate: row.scheduled_date,
    category: row.category,
  };
}
