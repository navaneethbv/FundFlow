import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  HoldingJoinRow,
  HoldingSnapshotRow,
  InvestmentTransactionRow,
} from "@/lib/investments";

interface HoldingQueryRow {
  id: string;
  account_id: string | null;
  manual_account_id: string | null;
  quantity: number | null;
  institution_price: number | null;
  institution_value: number | null;
  source: "plaid" | "manual";
  is_active: boolean;
  securities: {
    name: string;
    ticker: string | null;
    security_type: string | null;
    close_price: number | null;
  } | null;
}

/** Loads every holding visible to the caller (owner or shared household account), joined for display. */
export async function loadHoldings(
  supabase: SupabaseClient,
): Promise<HoldingJoinRow[]> {
  const { data, error } = await supabase
    .from("holdings")
    .select(
      "id, account_id, manual_account_id, quantity, institution_price, institution_value, source, is_active, securities(name, ticker, security_type, close_price)",
    );
  if (error) throw error;

  const rows = (data ?? []) as unknown as HoldingQueryRow[];
  const accountIds = rows.map((r) => r.account_id).filter((id): id is string => id != null);
  const manualAccountIds = rows
    .map((r) => r.manual_account_id)
    .filter((id): id is string => id != null);

  const [accountsResult, manualResult] = await Promise.all([
    accountIds.length > 0
      ? supabase.from("accounts").select("id, name").in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    manualAccountIds.length > 0
      ? supabase.from("manual_accounts").select("id, name").in("id", manualAccountIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (accountsResult.error) throw accountsResult.error;
  if (manualResult.error) throw manualResult.error;

  const accountNames = new Map<string, string>(
    (accountsResult.data ?? []).map((a: { id: string; name: string | null }) => [
      a.id,
      a.name ?? "Account",
    ]),
  );
  const manualNames = new Map<string, string>(
    (manualResult.data ?? []).map((a: { id: string; name: string }) => [a.id, a.name]),
  );

  return rows.map((row) => {
    const accountName = row.account_id
      ? accountNames.get(row.account_id) ?? "Account"
      : manualNames.get(row.manual_account_id ?? "") ?? "Manual account";
    return {
      id: row.id,
      accountId: row.account_id,
      manualAccountId: row.manual_account_id,
      accountName,
      securityName: row.securities?.name ?? "Unnamed security",
      ticker: row.securities?.ticker ?? null,
      securityType: row.securities?.security_type ?? null,
      quantity: row.quantity,
      price: row.institution_price ?? row.securities?.close_price ?? null,
      value: row.institution_value,
      source: row.source,
      isActive: row.is_active,
    };
  });
}

/**
 * Loads snapshot history for the caller's own holdings (used for balance
 * history and movers).
 *
 * `since` bounds the read to a date window. The Investments page's performance
 * chart genuinely needs the whole history and omits it; the dashboard widget
 * needs only the newest two dates and must pass one, because the dashboard
 * re-renders every two minutes and CLAUDE.md's frugality invariant forbids
 * reintroducing a select-all on that path.
 */
export async function loadHoldingSnapshots(
  supabase: SupabaseClient,
  options?: Readonly<{ since?: string }>,
): Promise<HoldingSnapshotRow[]> {
  let query = supabase
    .from("holding_snapshots")
    .select("holding_id, snapshot_date, quantity, price, value")
    .order("snapshot_date", { ascending: true });
  if (options?.since) query = query.gte("snapshot_date", options.since);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    holdingId: row.holding_id as string,
    snapshotDate: row.snapshot_date as string,
    quantity: row.quantity as number | null,
    price: row.price as number | null,
    value: row.value as number | null,
  }));
}

/** External-flow-relevant transaction rows for the caller's own accounts (Phase 9B). */
export async function loadInvestmentTransactions(
  supabase: SupabaseClient,
): Promise<InvestmentTransactionRow[]> {
  const { data, error } = await supabase
    .from("investment_transactions")
    .select("date, amount, txn_subtype")
    .eq("is_active", true)
    .order("date", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    date: row.date as string,
    amount: row.amount as number,
    txnSubtype: row.txn_subtype as string | null,
  }));
}

export interface AccountOption {
  id: string;
  name: string;
  source: "plaid" | "manual";
}

/** Every account (Plaid or manual) the caller could attach a manual holding to. */
export async function loadHoldingAccountOptions(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccountOption[]> {
  const [accountsResult, manualResult] = await Promise.all([
    supabase.from("accounts").select("id, name").eq("user_id", userId),
    supabase.from("manual_accounts").select("id, name").eq("user_id", userId),
  ]);
  if (accountsResult.error) throw accountsResult.error;
  if (manualResult.error) throw manualResult.error;

  return [
    ...(accountsResult.data ?? []).map((a: { id: string; name: string | null }) => ({
      id: a.id,
      name: a.name ?? "Account",
      source: "plaid" as const,
    })),
    ...(manualResult.data ?? []).map((a: { id: string; name: string }) => ({
      id: a.id,
      name: a.name,
      source: "manual" as const,
    })),
  ];
}
