import type { SupabaseClient } from "@supabase/supabase-js";

export interface LedgerStripAccount {
  id: string;
  name: string | null;
  mask: string | null;
  current_balance: number | null;
  iso_currency_code: string | null;
  type: string | null;
  user_id?: string | null;
}
export interface LedgerStripTransaction {
  id: string;
  date: string;
  amount: number;
  merchant_name: string | null;
  name: string | null;
}

export interface LedgerTick {
  id: string;
  date: string;
  label: string;
  amount: number;
  runningBalance: number;
  major: boolean;
}

/**
 * A tick earns a permanent label if it's an inflow, or an outflow of at
 * least this much. Deliberately separate from
 * `SpendingAnomalyInput.largeTransactionThreshold` in lib/planning.ts —
 * "worth a permanent label on a register" and "anomalous spending" are
 * different questions with no reason to share a threshold.
 */
const MAJOR_TICK_THRESHOLD = 100;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function pickAnchorAccount(
  accounts: readonly LedgerStripAccount[],
  options?: {
    ownerUserId?: string;
    selectedAccountId?: string;
  },
): LedgerStripAccount | null {
  if (options?.selectedAccountId) {
    const selected = accounts.find((account) => account.id === options.selectedAccountId);
    if (selected && selected.current_balance !== null) {
      if (options.ownerUserId && selected.user_id && selected.user_id !== options.ownerUserId) {
        return null;
      }
      return selected;
    }
  }

  return (
    accounts.find((account) => {
      if (account.type !== "depository" || account.current_balance === null) {
        return false;
      }
      if (options?.ownerUserId) {
        return account.user_id === options.ownerUserId;
      }
      return true;
    }) ?? null
  );
}

/**
 * Walks a single account's transactions in chronological order, converting
 * each from Plaid's sign convention (positive = out, negative = in) to a
 * signed ledger delta, and reconstructs the running balance that ends at
 * `currentBalance` — the same figure `AccountSummary.current_balance`
 * reports.
 */
export function buildLedgerStripTicks(
  transactions: readonly LedgerStripTransaction[],
  currentBalance: number,
  options: Readonly<{ majorThreshold?: number }> = {},
): LedgerTick[] {
  if (transactions.length === 0) {
    return [];
  }

  const majorThreshold = options.majorThreshold ?? MAJOR_TICK_THRESHOLD;
  const sorted = [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const netDelta = sorted.reduce((sum, transaction) => sum - transaction.amount, 0);
  let balance = round2(currentBalance - netDelta);

  return sorted.map((transaction) => {
    const delta = -transaction.amount;
    balance = round2(balance + delta);
    return {
      id: transaction.id,
      date: transaction.date,
      label: transaction.merchant_name ?? transaction.name ?? "Transaction",
      amount: delta,
      runningBalance: balance,
      major: delta > 0 || Math.abs(delta) >= majorThreshold,
    };
  });
}

function getMonthEndDate(month: string, today: string): string {
  if (today.startsWith(month)) {
    return today;
  }
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

export async function loadLedgerStripTicks(
  supabase: SupabaseClient,
  options: Readonly<{
    accountId: string;
    month: string;
    today: string;
    currentBalance: number;
  }>,
): Promise<LedgerTick[]> {
  const endDate = getMonthEndDate(options.month, options.today);
  const { data, error } = await supabase
    .from("transactions")
    .select("id, date, amount, merchant_name, name")
    .eq("account_id", options.accountId)
    .gte("date", `${options.month}-01`)
    .lte("date", endDate)
    .order("date", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  const allTicks = buildLedgerStripTicks(
    (data ?? []) as LedgerStripTransaction[],
    options.currentBalance,
  );

  return allTicks.filter((tick) => tick.date.startsWith(options.month));
}
