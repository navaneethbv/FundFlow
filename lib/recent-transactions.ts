import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecentTransaction } from "@/components/dashboard/RecentActivity";

/** The dashboard's five-row recent-activity query (RLS-scoped client). */
export async function getRecentTransactions({
  supabase,
  month,
  accountId,
}: {
  supabase: SupabaseClient;
  month: string;
  accountId?: string;
}): Promise<RecentTransaction[]> {
  const start = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const end = `${year}-${String((monthNumber ?? 1) + 1).padStart(2, "0")}-01`;
  const endDate = monthNumber === 12 ? `${(year ?? 0) + 1}-01-01` : end;

  let query = supabase
    .from("transactions")
    .select("id, date, amount, iso_currency_code, merchant_name, name, pfc_primary, account_id")
    .gte("date", start)
    .lt("date", endDate)
    .order("date", { ascending: false })
    .order("id", { ascending: true })
    .limit(5);

  if (accountId) query = query.eq("account_id", accountId);

  const { data } = await query;
  return (data ?? []) as RecentTransaction[];
}
