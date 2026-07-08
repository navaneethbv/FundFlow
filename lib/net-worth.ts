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
  const { data: plaidAccounts } = await supabase
    .from("accounts")
    .select("name, type, current_balance")
    .eq("user_id", userId);

  // 2. Fetch manual accounts
  const { data: manualAccounts } = await supabase
    .from("manual_accounts")
    .select("name, account_type, balance, include_in_net_worth")
    .eq("user_id", userId);

  // 3. Map to standard NetWorthAccount shape
  const accounts = [
    ...(plaidAccounts ?? []).map((a) => ({
      name: a.name,
      type: a.type,
      balance: a.current_balance !== null ? Number(a.current_balance) : null,
      includeInNetWorth: true,
    })),
    ...(manualAccounts ?? []).map((a) => ({
      name: a.name,
      type: a.account_type,
      balance: a.balance !== null ? Number(a.balance) : null,
      includeInNetWorth: a.include_in_net_worth,
    })),
  ];

  // 4. Compute snapshot
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
