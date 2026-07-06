import "server-only";
import type { AccountBase } from "plaid";
import { createServiceClient } from "@/lib/supabase/service";
import { encryptSecret, decryptSecret, decryptSecretDetailed } from "@/lib/crypto";
import type { PlaidItemRow } from "@/lib/types";
import { logError } from "@/lib/log";

const ITEM_COLUMNS =
  "id, user_id, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_iv, access_token_tag, sync_cursor, status, error_code";

/**
 * Encrypt and store a Plaid access token as a new plaid_items row. Returns the
 * row id. The plaintext token is never persisted or returned.
 */
export async function storeItem(params: {
  userId: string;
  plaidItemId: string;
  accessToken: string;
  institutionId?: string | null;
  institutionName?: string | null;
}): Promise<string> {
  const supabase = createServiceClient();
  const enc = encryptSecret(params.accessToken);

  const { data, error } = await supabase
    .from("plaid_items")
    .insert({
      user_id: params.userId,
      plaid_item_id: params.plaidItemId,
      institution_id: params.institutionId ?? null,
      institution_name: params.institutionName ?? null,
      access_token_ciphertext: enc.ciphertext,
      access_token_iv: enc.iv,
      access_token_tag: enc.tag,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

/** Decrypt the access token stored on an item row. */
export function decryptItemToken(item: PlaidItemRow): string {
  return decryptSecret({
    ciphertext: item.access_token_ciphertext,
    iv: item.access_token_iv,
    tag: item.access_token_tag,
  });
}

/**
 * Decrypt the item's token and, if it was still encrypted with the previous
 * key (PLAID_TOKEN_ENC_KEY_PREVIOUS during rotation), re-encrypt it with the
 * current key in place. Called from the daily sync, so a rotation converges
 * on its own within a day. The upgrade is best-effort: a failed write only
 * means the fallback key is needed a little longer.
 */
export async function decryptItemTokenAndUpgrade(
  item: PlaidItemRow,
): Promise<string> {
  const { plaintext, usedFallbackKey } = decryptSecretDetailed({
    ciphertext: item.access_token_ciphertext,
    iv: item.access_token_iv,
    tag: item.access_token_tag,
  });

  if (usedFallbackKey) {
    try {
      const enc = encryptSecret(plaintext);
      const supabase = createServiceClient();
      const { error } = await supabase
        .from("plaid_items")
        .update({
          access_token_ciphertext: enc.ciphertext,
          access_token_iv: enc.iv,
          access_token_tag: enc.tag,
        })
        .eq("id", item.id);
      if (error) throw error;
    } catch (error) {
      logError("plaid-service.token-rotation", error);
    }
  }

  return plaintext;
}

/** Look up an item by its Plaid-side item id (webhook payloads carry these). */
export async function getItemByPlaidItemId(
  plaidItemId: string,
): Promise<PlaidItemRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("plaid_items")
    .select(ITEM_COLUMNS)
    .eq("plaid_item_id", plaidItemId)
    .maybeSingle();
  if (error) throw error;
  return (data as PlaidItemRow) ?? null;
}

/** Load all active items for a user (scoped by user_id). */
export async function listActiveItems(userId: string): Promise<PlaidItemRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("plaid_items")
    .select(ITEM_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  return (data ?? []) as PlaidItemRow[];
}

/** Load a single item by id, scoped to the owning user. */
export async function getItem(
  userId: string,
  itemId: string,
): Promise<PlaidItemRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("plaid_items")
    .select(ITEM_COLUMNS)
    .eq("user_id", userId)
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw error;
  return (data as PlaidItemRow) ?? null;
}

/** Upsert accounts for an item. Balances refresh on every sync. */
export async function upsertAccounts(
  userId: string,
  itemDbId: string,
  accounts: AccountBase[],
): Promise<void> {
  if (accounts.length === 0) return;
  const supabase = createServiceClient();

  const rows = accounts.map((a) => ({
    user_id: userId,
    plaid_item_id: itemDbId,
    plaid_account_id: a.account_id,
    name: a.name ?? null,
    official_name: a.official_name ?? null,
    mask: a.mask ?? null, // masked number only
    type: a.type ?? null,
    subtype: a.subtype ?? null,
    current_balance: a.balances.current ?? null,
    available_balance: a.balances.available ?? null,
    credit_limit: a.balances.limit ?? null,
    iso_currency_code: a.balances.iso_currency_code ?? null,
  }));

  const { error } = await supabase
    .from("accounts")
    .upsert(rows, { onConflict: "plaid_account_id" });
  if (error) throw error;
}

/** Update an item's stored sync cursor. */
export async function updateItemCursor(
  itemDbId: string,
  cursor: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("plaid_items")
    .update({ sync_cursor: cursor })
    .eq("id", itemDbId);
  if (error) throw error;
}

/** Mark an item's status (and optional error code, never PII). */
export async function setItemStatus(
  itemDbId: string,
  status: PlaidItemRow["status"],
  errorCode: string | null = null,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("plaid_items")
    .update({ status, error_code: errorCode })
    .eq("id", itemDbId);
  if (error) throw error;
}

/**
 * Map an account_id -> our accounts.id for a user, so transactions can be linked
 * by our FK. Returns a lookup keyed by Plaid account_id.
 */
export async function getAccountIdMap(
  userId: string,
): Promise<Map<string, string>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, plaid_account_id")
    .eq("user_id", userId);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.plaid_account_id as string, row.id as string);
  }
  return map;
}
