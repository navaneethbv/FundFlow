import { createServiceClient } from "@/lib/supabase/service";
import { computeNetWorthSnapshot } from "@/lib/planning";

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
  let excludedNetWorthIds = new Set<string>();
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("dashboard_prefs")
      .eq("id", userId)
      .maybeSingle();
    const accountsPage = (profile?.dashboard_prefs as Record<string, unknown> | null)?.accountsPage as
      | { excludedNetWorthIds?: string[] }
      | undefined;
    if (Array.isArray(accountsPage?.excludedNetWorthIds)) {
      excludedNetWorthIds = new Set(accountsPage.excludedNetWorthIds);
    }
  } catch {
    // If profiles query is unavailable or omitted in minimal client stubs, proceed with empty set
  }

  // 4. Map to standard NetWorthAccount shape
  const accounts = [
    ...(plaidAccounts ?? []).map((a) => ({
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      balance: a.current_balance !== null ? Number(a.current_balance) : null,
      includeInNetWorth: !excludedNetWorthIds.has(a.id),
    })),
    ...(manualAccounts ?? []).map((a) => ({
      name: a.name,
      type: a.account_type,
      balance: a.balance !== null ? Number(a.balance) : null,
      includeInNetWorth: a.include_in_net_worth && !excludedNetWorthIds.has(a.id),
    })),
  ];

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
