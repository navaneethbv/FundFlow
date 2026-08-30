import "server-only";
import type { CreditCardLiability } from "plaid";
import { getPlaidClient } from "@/lib/plaid";
import { createServiceClient } from "@/lib/supabase/service";
import { decryptItemTokenAndUpgrade } from "@/lib/plaid-service";
import type { PlaidItemRow } from "@/lib/types";
import { logError } from "@/lib/log";

export type LiabilitiesSyncOutcome =
  | "synced"
  | "product_not_ready"
  | "no_liabilities"
  | "rate_limited";

export interface LiabilitiesSyncResult {
  outcome: LiabilitiesSyncOutcome;
  billsSynced: number;
}

function plaidErrorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { error_code?: unknown } } })
    ?.response?.data?.error_code;
  return typeof code === "string" ? code : null;
}

function liabilityOutcome(error: unknown): LiabilitiesSyncOutcome | null {
  const code = plaidErrorCode(error);
  if (code === "PRODUCT_NOT_READY") return "product_not_ready";
  if (code === "RATE_LIMIT" || code === "RATE_LIMIT_EXCEEDED") return "rate_limited";
  return null;
}

function billDate(value: string | null | undefined): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function removeStaleBills(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  itemAccountIds: string[],
  activeAccountIds: Set<string>,
): Promise<void> {
  if (itemAccountIds.length === 0) return;
  const { data: existingBills, error: existingBillsError } = await supabase
    .from("credit_card_bills")
    .select("account_id")
    .eq("user_id", userId)
    .in("account_id", itemAccountIds);
  if (existingBillsError) throw existingBillsError;

  const staleAccountIds = (existingBills ?? [])
    .map((bill) => bill.account_id as string)
    .filter((accountId) => !activeAccountIds.has(accountId));
  if (staleAccountIds.length === 0) return;
  const { error: deleteError } = await supabase
    .from("credit_card_bills")
    .delete()
    .eq("user_id", userId)
    .in("account_id", staleAccountIds);
  if (deleteError) throw deleteError;
}

/**
 * Sync one item's credit-card liabilities via the approved Plaid Liabilities
 * integration. Statement balance, minimum payment, due date, and sync time are
 * stored on the item's credit account, separate from purchase streams. Only
 * real provider data is ever written; a missing product or an empty portfolio
 * never invents a bill. Each bill row is scoped to the item's own account.
 */
export async function syncCreditCardLiabilities(
  item: PlaidItemRow,
): Promise<LiabilitiesSyncResult> {
  const plaid = getPlaidClient();
  const accessToken = await decryptItemTokenAndUpgrade(item);

  let response;
  try {
    response = await plaid.liabilitiesGet({ access_token: accessToken });
  } catch (error) {
    const outcome = liabilityOutcome(error);
    if (outcome) return { outcome, billsSynced: 0 };
    throw error;
  }

  const credit = (response.data.liabilities.credit ?? []) as CreditCardLiability[];
  const supabase = createServiceClient();
  // Scoped to this item's own accounts only, matching the investment sync
  // isolation rule.
  const { data: itemAccounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id, plaid_account_id")
    .eq("plaid_item_id", item.id)
    .eq("user_id", item.user_id);
  if (accountsError) throw accountsError;
  const accountIdMap = new Map<string, string>(
    (itemAccounts ?? []).map((account) => [
      account.plaid_account_id as string,
      account.id as string,
    ]),
  );
  const itemAccountIds = [...accountIdMap.values()];

  const rows = credit
    .map((liability) => {
      const accountDbId = liability.account_id ? accountIdMap.get(liability.account_id) : undefined;
      if (!accountDbId) return null;
      return {
        user_id: item.user_id,
        account_id: accountDbId,
        statement_balance: liability.last_statement_balance ?? null,
        minimum_payment: liability.minimum_payment_amount ?? null,
        due_date: billDate(liability.next_payment_due_date),
        payment_account_id: null,
        sync_timestamp: new Date().toISOString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length > 0) {
    const { error } = await supabase
      .from("credit_card_bills")
      .upsert(rows, { onConflict: "user_id,account_id" });
    if (error) throw error;
  }

  await removeStaleBills(
    supabase,
    item.user_id,
    itemAccountIds,
    new Set(rows.map((row) => row.account_id)),
  );

  if (rows.length === 0) return { outcome: "no_liabilities", billsSynced: 0 };

  return { outcome: "synced", billsSynced: rows.length };
}

/**
 * Sync credit-card liabilities for every active item a user has, isolating
 * per-item failures like the investment sync does.
 */
export async function syncCreditCardLiabilitiesForUser(
  userId: string,
): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("plaid_items")
    .select("id, user_id, plaid_item_id, institution_id, institution_name, institution_logo, institution_brand_color, access_token_ciphertext, access_token_iv, access_token_tag, sync_cursor, status, error_code")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;

  let totalSynced = 0;
  for (const row of (data ?? []) as PlaidItemRow[]) {
    try {
      const result = await syncCreditCardLiabilities(row);
      totalSynced += result.billsSynced;
    } catch (syncError) {
      logError("liabilities-sync.item", syncError);
    }
  }
  return totalSynced;
}
