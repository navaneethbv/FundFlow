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

/**
 * Picks the account the strip reconstructs a running balance for.
 *
 * Ownership fails **closed**: personal scope without a known `ownerUserId`
 * matches nothing rather than falling through to whatever account is first.
 * `household` is the only way to span owners, and it has to be passed
 * deliberately — `getDashboardData` drops its `user_id` filter in that scope,
 * so an accidentally-empty id must never be what widens the match.
 */
export function pickAnchorAccount(
  accounts: readonly LedgerStripAccount[],
  options?: Readonly<{
    ownerUserId?: string;
    selectedAccountId?: string;
    household?: boolean;
  }>,
): LedgerStripAccount | null {
  const requireOwner = !options?.household;
  const ownerUserId = options?.ownerUserId;
  if (requireOwner && !ownerUserId) {
    return null;
  }

  // The running balance walks Plaid's sign convention against a depository
  // balance, so a credit or loan account would read inverted. Selecting one
  // yields no anchor, and the widget hides itself rather than lying.
  const isAnchorable = (account: LedgerStripAccount): boolean =>
    account.type === "depository" &&
    account.current_balance !== null &&
    (!requireOwner || account.user_id === ownerUserId);

  if (options?.selectedAccountId) {
    const selected = accounts.find((account) => account.id === options.selectedAccountId);
    return selected && isAnchorable(selected) ? selected : null;
  }

  return accounts.find(isAnchorable) ?? null;
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

/** PostgREST caps a response at `db.max_rows` (1000 by default), so every
 *  read here pages rather than trusting a single request to be complete. */
const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  runPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await runPage(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw error;
    }
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }
}

/**
 * Net of everything that landed after `afterDate` through `today`, in Plaid's
 * sign convention. Only `amount` is selected, so re-anchoring a past month
 * stays cheap even over a long tail.
 */
async function sumAmountsAfter(
  supabase: SupabaseClient,
  accountId: string,
  afterDate: string,
  today: string,
): Promise<number> {
  const rows = await fetchAllRows<{ amount: number }>((from, to) =>
    supabase
      .from("transactions")
      .select("amount")
      .eq("account_id", accountId)
      .gt("date", afterDate)
      .lte("date", today)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.reduce((sum, row) => sum + row.amount, 0);
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

  const transactions = await fetchAllRows<LedgerStripTransaction>((from, to) =>
    supabase
      .from("transactions")
      .select("id, date, amount, merchant_name, name")
      .eq("account_id", options.accountId)
      .gte("date", `${options.month}-01`)
      .lte("date", endDate)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  // `currentBalance` is today's balance, and `buildLedgerStripTicks` walks
  // backwards from it. For a month that has already closed, that walk has to
  // start from the balance as of month end, or every figure in the strip is
  // off by the net of everything booked since. balance(end) =
  // balance(today) + sum(amount after end), because positive amount = money out.
  const anchorBalance =
    endDate < options.today
      ? round2(
          options.currentBalance +
            (await sumAmountsAfter(supabase, options.accountId, endDate, options.today)),
        )
      : options.currentBalance;

  return buildLedgerStripTicks(transactions, anchorBalance);
}
