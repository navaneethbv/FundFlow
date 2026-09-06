import { createServiceClient } from "@/lib/supabase/service";
import { computeNetWorthSnapshot } from "@/lib/planning";
import {
  composeNetWorthAccounts,
  readExcludedNetWorthIds,
  type ManualBalanceRow,
  type PlaidBalanceRow,
} from "@/lib/net-worth-inputs";

/**
 * Computes the net worth (assets and liabilities) for a user and upserts
 * a snapshot record into the `net_worth_snapshots` table for the current month.
 */
export async function writeNetWorthSnapshot(userId: string) {
  const supabase = createServiceClient();
  const currentMonthDate = `${new Date().toISOString().slice(0, 7)}-01`; // YYYY-MM-01

  // 1. Fetch Plaid accounts
  const { data: plaidAccounts, error: plaidError } = await supabase
    .from("accounts")
    .select("id, name, type, subtype, current_balance")
    .eq("user_id", userId);
  if (plaidError) throw plaidError;

  // 2. Fetch manual accounts
  const { data: manualAccounts, error: manualError } = await supabase
    .from("manual_accounts")
    .select("id, name, account_type, balance, include_in_net_worth")
    .eq("user_id", userId);
  if (manualError) throw manualError;

  // 3. Respect user exclusions from preferences if configured
  const profileQuery = supabase
    .from("profiles")
    .select("dashboard_prefs")
    .eq("id", userId);
  const profileResult = typeof (profileQuery as { maybeSingle?: unknown }).maybeSingle === "function"
    ? await (profileQuery as typeof profileQuery & { maybeSingle: () => Promise<{ data?: unknown; error?: unknown }> }).maybeSingle()
    : await profileQuery;
  const profile = profileResult.data as { dashboard_prefs?: unknown } | null | undefined;
  const profileError = profileResult.error;
  if (profileError) throw profileError;
  const excludedNetWorthIds = readExcludedNetWorthIds(profile?.dashboard_prefs);

  // 4. Map to standard NetWorthAccount shape
  const accounts = composeNetWorthAccounts({
    plaidAccounts: (plaidAccounts ?? []) as PlaidBalanceRow[],
    manualAccounts: (manualAccounts ?? []) as ManualBalanceRow[],
    excludedNetWorthIds,
  });

  // 5. Compute snapshot
  const snapshot = computeNetWorthSnapshot(accounts);

  // 5. Upsert on user_id + snapshot_month
  const { data, error } = await supabase
    .from("net_worth_snapshots")
    .upsert(
      {
        user_id: userId,
        snapshot_month: currentMonthDate,
        assets: snapshot.assets,
        liabilities: snapshot.liabilities,
      },
      { onConflict: "user_id,snapshot_month" }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}
