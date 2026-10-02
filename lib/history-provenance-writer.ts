import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/feature-flags";
/** Service-only write, for a known owner. The SQL function validates ownership. */
export async function recordEstimatedAccountHistory(
  service: SupabaseClient,
  input: Readonly<{
    userId: string;
    accountId: string | null;
    manualAccountId: string | null;
    date: string;
    balance: number;
    currency: string;
  }>,
): Promise<boolean> {
  if (!isFeatureEnabled("historyProvenance")) return false;
  const { data, error } = await service.rpc(
    "record_estimated_account_history",
    {
      p_user_id: input.userId,
      p_account_id: input.accountId,
      p_manual_account_id: input.manualAccountId,
      p_date: input.date,
      p_balance: input.balance,
      p_currency: input.currency,
    },
  );
  if (error) throw error;
  return data === true;
}
