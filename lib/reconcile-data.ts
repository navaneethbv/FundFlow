import type { SupabaseClient } from "@supabase/supabase-js";

export interface AccountReconciliationRow {
  accountId: string;
  accountName: string;
  institutionName: string;
  type: string;
  subtype: string | null;
  currency: string;
  providerBalance: number;
  calculatedLedgerBalance: number;
  difference: number;
  transactionCount: number;
  coverageStart: string | null;
  coverageEnd: string | null;
  lastSyncAt: string | null;
  isStale: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

export function buildAccountReconciliationRows(params: {
  accounts: Array<{
    id: string;
    name: string | null;
    type: string | null;
    subtype: string | null;
    current_balance: number | null;
    iso_currency_code: string | null;
    plaid_item_id: string | null;
    updated_at: string | null;
  }>;
  items: Array<{ id: string; institution_name: string | null }>;
  transactions: Array<{
    account_id: string;
    amount: number;
    date: string;
  }>;
  now?: Date;
}): AccountReconciliationRow[] {
  const nowMs = (params.now ?? new Date()).getTime();
  const itemMap = new Map(params.items.map((i) => [i.id, i.institution_name ?? "Bank"]));

  // Group transactions by account_id
  const txByAccount = new Map<
    string,
    { count: number; sum: number; minDate: string | null; maxDate: string | null }
  >();

  for (const tx of params.transactions) {
    if (!tx.account_id) continue;
    const existing = txByAccount.get(tx.account_id) ?? {
      count: 0,
      sum: 0,
      minDate: null,
      maxDate: null,
    };
    existing.count += 1;
    existing.sum += Number(tx.amount || 0);
    if (!existing.minDate || tx.date < existing.minDate) existing.minDate = tx.date;
    if (!existing.maxDate || tx.date > existing.maxDate) existing.maxDate = tx.date;
    txByAccount.set(tx.account_id, existing);
  }

  return params.accounts.map((acc) => {
    const txData = txByAccount.get(acc.id) ?? {
      count: 0,
      sum: 0,
      minDate: null,
      maxDate: null,
    };

    const providerBalance = round2(Number(acc.current_balance ?? 0));
    // Plaid convention: positive amount is money out.
    // For a credit card: charges increase balance (net charges = sum).
    // For checking/depository: money in is negative, money out is positive; net cashflow = -sum.
    const isCredit = acc.type === "credit" || acc.type === "loan";
    const calculatedLedgerBalance = isCredit ? round2(txData.sum) : round2(-txData.sum);
    const difference = round2(providerBalance - calculatedLedgerBalance);

    const lastSyncMs = acc.updated_at ? Date.parse(acc.updated_at) : 0;
    const isStale = !lastSyncMs || nowMs - lastSyncMs > STALE_THRESHOLD_MS;

    return {
      accountId: acc.id,
      accountName: acc.name ?? "Unnamed Account",
      institutionName: (acc.plaid_item_id ? itemMap.get(acc.plaid_item_id) : null) ?? "Manual",
      type: acc.type ?? "depository",
      subtype: acc.subtype ?? null,
      currency: (acc.iso_currency_code ?? "USD").toUpperCase(),
      providerBalance,
      calculatedLedgerBalance,
      difference,
      transactionCount: txData.count,
      coverageStart: txData.minDate,
      coverageEnd: txData.maxDate,
      lastSyncAt: acc.updated_at,
      isStale,
    };
  });
}

/**
 * Load all account reconciliation metrics for the authenticated user.
 */
export async function loadAccountReconciliation(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<AccountReconciliationRow[]> {
  const [accountsRes, itemsRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, type, subtype, current_balance, iso_currency_code, plaid_item_id, updated_at")
      .eq("user_id", userId)
      .order("name"),
    supabase
      .from("plaid_items")
      .select("id, institution_name")
      .eq("user_id", userId),
  ]);

  const accounts = accountsRes.data ?? [];
  const items = itemsRes.data ?? [];
  if (accounts.length === 0) return [];

  // Page transactions in 1000-row chunks with explicit date+id ordering to prevent PostgREST silent capping
  const allTransactions: Array<{ account_id: string; amount: number; date: string }> = [];
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data: chunk, error } = await supabase
      .from("transactions")
      .select("account_id, amount, date")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error || !chunk || chunk.length === 0) {
      break;
    }
    allTransactions.push(...chunk);
    if (chunk.length < pageSize) {
      hasMore = false;
    } else {
      page += 1;
    }
  }

  return buildAccountReconciliationRows({
    accounts,
    items,
    transactions: allTransactions,
    now,
  });
}
