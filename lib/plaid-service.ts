import "server-only";
import { createHash } from "node:crypto";
import type { AccountBase } from "plaid";
import { createServiceClient } from "@/lib/supabase/service";
import { encryptSecret, decryptSecret, decryptSecretDetailed } from "@/lib/crypto";
import { getPlaidClient } from "@/lib/plaid";
import type { PlaidItemRow } from "@/lib/types";
import { logError } from "@/lib/log";

const ITEM_COLUMNS =
  "id, user_id, plaid_item_id, institution_id, institution_name, institution_logo, institution_brand_color, access_token_ciphertext, access_token_iv, access_token_tag, sync_cursor, status, error_code, access_token_rotated_at";

/** How often an item's Plaid access token is rotated. */
export const TOKEN_ROTATION_DAYS = 30;

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
  institutionLogo?: string | null;
  institutionBrandColor?: string | null;
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
      institution_logo: params.institutionLogo ?? null,
      institution_brand_color: params.institutionBrandColor ?? null,
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

/**
 * SHA-256 hash of a Plaid link token. Only the hash is ever stored, so a leak
 * of the plaid_link_tokens table cannot be used to replay an exchange.
 */
export function hashLinkToken(linkToken: string): string {
  return createHash("sha256").update(linkToken).digest("hex");
}

/**
 * Persist a hashed, user-bound record of a freshly created link token so the
 * exchange step can prove the submitted public token came from a link token
 * this user actually created. Uses Plaid's expiration when present; link tokens
 * otherwise default to 4h (new items) / 30m (update mode).
 */
export async function storeLinkToken(
  userId: string,
  linkToken: string,
  expirationIso: string | null,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("plaid_link_tokens").insert({
    user_id: userId,
    token_hash: hashLinkToken(linkToken),
    expires_at: expirationIso ?? null,
  });
  if (error) throw error;
}

/**
 * Verify and single-use consume a link token for the exchange step-up. Returns
 * true only when the token was created for this user, is unexpired, and is not
 * already consumed; it then marks it consumed so a replayed public token cannot
 * be exchanged twice. The compare-and-set on consumed_at keeps two concurrent
 * exchanges from both passing.
 */
export async function consumeLinkToken(
  userId: string,
  linkToken: string,
): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("plaid_link_tokens")
    .select("id, expires_at, consumed_at")
    .eq("user_id", userId)
    .eq("token_hash", hashLinkToken(linkToken))
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  if (data.consumed_at) return false;
  if (
    data.expires_at &&
    new Date(data.expires_at as string).getTime() < Date.now()
  ) {
    return false;
  }
  const { error: updateError } = await supabase
    .from("plaid_link_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", data.id)
    .eq("consumed_at", null);
  if (updateError) throw updateError;
  return true;
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
 * Rotate a single item's Plaid access token via /item/access_token/invalidate,
 * which returns a fresh token and immediately invalidates the old one. The new
 * token is re-encrypted and persisted, and `access_token_rotated_at` is
 * stamped. Best-effort: a failure (e.g. the token is already unusable) is
 * logged and the old token stays in place, so rotation can never break a sync.
 * Use this directly to rotate immediately after a suspected compromise.
 */
export async function rotateItemAccessToken(item: PlaidItemRow): Promise<boolean> {
  const plaintext = decryptItemToken(item);
  try {
    const plaid = getPlaidClient();
    const response = await plaid.itemAccessTokenInvalidate({
      access_token: plaintext,
    });
    const newToken = response.data.new_access_token;
    if (!newToken) return false;

    const enc = encryptSecret(newToken);
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("plaid_items")
      .update({
        access_token_ciphertext: enc.ciphertext,
        access_token_iv: enc.iv,
        access_token_tag: enc.tag,
        access_token_rotated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (error) throw error;
    return true;
  } catch (error) {
    logError("plaid-service.token-rotation", error);
    return false;
  }
}

/**
 * Rotate access tokens for every active item of a user that hasn't been
 * rotated in the last {@link TOKEN_ROTATION_DAYS} (or ever). Called from the
 * daily sync so rotation stays periodic. Returns how many tokens were rotated;
 * per-item failures are isolated and logged.
 */
export async function rotateStaleItemTokens(userId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("plaid_items")
    .select(ITEM_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;

  const cutoffMs = Date.now() - TOKEN_ROTATION_DAYS * 24 * 3600 * 1000;
  const stale = ((data ?? []) as PlaidItemRow[]).filter((row) => {
    const last = row.access_token_rotated_at as string | null;
    return !last || new Date(last).getTime() < cutoffMs;
  });

  let rotated = 0;
  for (const item of stale) {
    if (await rotateItemAccessToken(item)) rotated += 1;
  }
  return rotated;
}

export async function updateItemBranding(
  userId: string,
  itemDbId: string,
  branding: {
    name: string;
    logo: string | null;
    brandColor: string | null;
  },
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("plaid_items")
    .update({
      institution_name: branding.name,
      institution_logo: branding.logo,
      institution_brand_color: branding.brandColor,
    })
    .eq("id", itemDbId)
    .eq("user_id", userId);
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
