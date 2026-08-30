import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/log";

export type SnapshotPlaidAccount = {
  id: string;
  current_balance: number | string | null;
  available_balance: number | string | null;
  iso_currency_code: string | null;
};

export interface SnapshotManualAccount {
  id: string;
  balance: number | string | null;
  include_in_net_worth: boolean;
}

export interface AccountBalanceSnapshotInsert {
  user_id: string;
  account_id: string | null;
  manual_account_id: string | null;
  snapshot_date: string;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string;
  captured_at: string;
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError("Snapshot date must use YYYY-MM-DD");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError("Snapshot date must be a real calendar date");
  }
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "") {
    throw new RangeError("Balance must be numeric");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new RangeError("Balance must be finite");
  }
  return parsed;
}

function currencyCode(value: string | null): string {
  const normalized = value?.trim().toUpperCase() || "USD";
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new RangeError("Currency must use a three-letter code");
  }
  return normalized;
}

export function shapeDailyAccountSnapshots(input: {
  userId: string;
  plaidAccounts: SnapshotPlaidAccount[];
  manualAccounts: SnapshotManualAccount[];
  snapshotDate: string;
  capturedAt?: string;
}): AccountBalanceSnapshotInsert[] {
  assertDate(input.snapshotDate);
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new RangeError("Snapshot capture time must be an ISO timestamp");
  }

  const plaidRows = input.plaidAccounts.flatMap((account) => {
    const currentBalance = numberOrNull(account.current_balance);
    if (currentBalance === null) return [];
    return [
      {
        user_id: input.userId,
        account_id: account.id,
        manual_account_id: null,
        snapshot_date: input.snapshotDate,
        current_balance: currentBalance,
        available_balance: numberOrNull(account.available_balance),
        iso_currency_code: currencyCode(account.iso_currency_code),
        captured_at: capturedAt,
      },
    ];
  });

  const manualRows = input.manualAccounts.flatMap((account) => {
    const currentBalance = numberOrNull(account.balance);
    if (!account.include_in_net_worth || currentBalance === null) return [];
    return [
      {
        user_id: input.userId,
        account_id: null,
        manual_account_id: account.id,
        snapshot_date: input.snapshotDate,
        current_balance: currentBalance,
        available_balance: null,
        iso_currency_code: "USD",
        captured_at: capturedAt,
      },
    ];
  });

  return [...plaidRows, ...manualRows];
}

export async function writeDailyAccountSnapshots(
  userId: string,
  snapshotDate = new Date().toISOString().slice(0, 10),
): Promise<{ written: number; snapshotDate: string }> {
  const service = createServiceClient();
  const [plaidResult, manualResult] = await Promise.all([
    service
      .from("accounts")
      .select("id,current_balance,available_balance,iso_currency_code")
      .eq("user_id", userId),
    service
      .from("manual_accounts")
      .select("id,balance,include_in_net_worth")
      .eq("user_id", userId),
  ]);

  if (plaidResult.error) throw plaidResult.error;
  if (manualResult.error) throw manualResult.error;

  const rows = shapeDailyAccountSnapshots({
    userId,
    snapshotDate,
    // One timestamp describes the complete account read above. Re-upserting a
    // same-day snapshot must refresh this boundary along with its balance.
    capturedAt: new Date().toISOString(),
    plaidAccounts: (plaidResult.data ?? []) as SnapshotPlaidAccount[],
    manualAccounts: (manualResult.data ?? []) as SnapshotManualAccount[],
  });

  if (rows.length === 0) return { written: 0, snapshotDate };

  const { error } = await service.from("account_balance_snapshots").upsert(rows, {
    onConflict: "account_id,manual_account_id,snapshot_date",
  });
  if (error) throw error;

  return { written: rows.length, snapshotDate };
}

/**
 * Snapshot capture for request paths whose primary work has already committed
 * (a manual-account write, a completed Plaid sync). Losing one day of history
 * must never turn a succeeded operation into a 500 the user reads as failure —
 * the daily cron re-captures the same current-state row anyway.
 *
 * The cron itself calls `writeDailyAccountSnapshots` directly, because there a
 * failure should be recorded rather than swallowed.
 */
export async function tryWriteDailyAccountSnapshots(
  userId: string,
  context: string,
): Promise<void> {
  try {
    await writeDailyAccountSnapshots(userId);
  } catch (error) {
    logError(context, error);
  }
}
