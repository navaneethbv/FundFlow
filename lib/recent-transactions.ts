import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecentTransaction } from "@/components/dashboard/RecentActivity";

/**
 * The dashboard's five-row recent-activity query (RLS-scoped client).
 *
 * `userId` must mirror the caller's scope, exactly like `scopeUser` in
 * `dashboard.ts`: pass it in "mine" scope and omit it in household scope.
 * Leaving it out unconditionally would let household rows leak into a widget
 * sitting beside scoped ones, because RLS also exposes a household member's
 * shared transactions.
 */
export async function getRecentTransactions({
  supabase,
  month,
  accountId,
  userId,
}: {
  supabase: SupabaseClient;
  month: string;
  accountId?: string;
  userId?: string;
}): Promise<RecentTransaction[]> {
  const start = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  // c8 ignore next -- month.split("-").map(Number) always yields a number
  const nextMonth = (monthNumber ?? 1) + 1;
  const end = `${year}-${String(nextMonth).padStart(2, "0")}-01`;
  // c8 ignore next -- month.split("-").map(Number) always yields a number
  const nextYear = (year ?? 0) + 1;
  const endDate = monthNumber === 12 ? `${nextYear}-01-01` : end;

  let query = supabase
    .from("transactions")
    .select("id, date, amount, iso_currency_code, merchant_name, name, pfc_primary, account_id")
    .gte("date", start)
    .lt("date", endDate)
    .order("date", { ascending: false })
    .order("id", { ascending: true })
    .limit(5);

  if (userId) query = query.eq("user_id", userId);
  if (accountId) query = query.eq("account_id", accountId);

  const { data } = await query;
  return (data ?? []) as RecentTransaction[];
}
