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
  ownerUserId?: string,
): LedgerStripAccount | null {
  return (
    accounts.find(
      (account) =>
        account.type === "depository" &&
        account.current_balance !== null &&
        (!ownerUserId || account.user_id === ownerUserId),
    ) ?? null
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

export async function loadLedgerStripTicks(
  supabase: SupabaseClient,
  options: Readonly<{
    accountId: string;
    month: string;
    today: string;
    currentBalance: number;
  }>,
): Promise<LedgerTick[]> {
  const pageSize = 1000;
  const transactions: LedgerStripTransaction[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, date, amount, merchant_name, name")
      .eq("account_id", options.accountId)
      .gte("date", `${options.month}-01`)
      .lte("date", options.today)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw error;
    }

    const page = (data ?? []) as LedgerStripTransaction[];
    transactions.push(...page);
    if (page.length < pageSize) {
      break;
    }
  }

  const allTicks = buildLedgerStripTicks(
    transactions,
    options.currentBalance,
  );

  return allTicks.filter((tick) => tick.date.startsWith(options.month));
}
