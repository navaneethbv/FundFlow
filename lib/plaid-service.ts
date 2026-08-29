import "server-only";
import { createHash } from "node:crypto";
import type { AccountBase } from "plaid";
import { createServiceClient } from "@/lib/supabase/service";
import { encryptSecret, decryptSecret, decryptSecretDetailed } from "@/lib/crypto";
import { normalizeExternalDisplayText } from "@/lib/external-display-text";
import { getPlaidClient } from "@/lib/plaid";
import type { PlaidItemRow } from "@/lib/types";
import { logError } from "@/lib/log";

const ITEM_COLUMNS =
  "id, user_id, plaid_item_id, institution_id, institution_name, institution_logo, institution_brand_color, access_token_ciphertext, access_token_iv, access_token_tag, sync_cursor, status, error_code, access_token_rotated_at, last_sync_attempt_at, last_sync_success_at, last_sync_completed_pages, initial_history_incomplete, cursor_reset_detected_at";

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
    name: normalizeExternalDisplayText(a.name),
    official_name: normalizeExternalDisplayText(a.official_name),
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

/**
 * Update an item's stored sync cursor, scoped to the owning user so a forged
 * or cross-user item id can never advance another user's cursor.
 */
export async function updateItemCursor(
  userId: string,
  itemDbId: string,
  cursor: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("plaid_items")
    .update({ sync_cursor: cursor })
    .eq("id", itemDbId)
    .eq("user_id", userId);
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
  // Compare-and-set: `.is(..., null)` is the only filter PostgREST reads as an
  // IS NULL test (`.eq(col, null)` sends `eq.null`, which errors on a timestamp
  // column), and the returning `select` is what makes the CAS observable, because an
  // update that matched no row reports no error, so without it a second
  // concurrent exchange would also be told it won.
  const { data: consumed, error: updateError } = await supabase
    .from("plaid_link_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", data.id)
    .is("consumed_at", null)
    .select("id");
  if (updateError) throw updateError;
  return (consumed ?? []).length > 0;
}

/** Mark an item's status (and optional error code, never PII), user-scoped. */
export async function setItemStatus(
  userId: string,
  itemDbId: string,
  status: PlaidItemRow["status"],
  errorCode: string | null = null,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("plaid_items")
    .update({ status, error_code: errorCode })
    .eq("id", itemDbId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Attempts left to store a rotated token before the connection is written off. */
const PERSIST_RETRIES = 3;

/**
 * Seconds before a crashed run's item claim may be taken over. Mirrors
 * STALE_SYNC_SECONDS in lib/sync.ts; duplicated rather than imported because
 * lib/sync.ts already imports from this module.
 */
const STALE_CLAIM_SECONDS = 5 * 60;

/**
 * Flag an item whose access token was invalidated at Plaid but could not be
 * stored. Only a re-link can recover it, so surface it the same way any other
 * broken connection is surfaced rather than leaving it "active" with a dead
 * token.
 */
async function markItemTokenLost(userId: string, itemDbId: string): Promise<void> {
  try {
    await setItemStatus(userId, itemDbId, "error", "TOKEN_ROTATION_LOST");
  } catch (error) {
    logError("plaid-service.token-rotation-status", error);
  }
}

/**
 * Rotate a single item's Plaid access token via /item/access_token/invalidate,
 * which returns a fresh token and immediately invalidates the old one. The new
 * token is re-encrypted and persisted, and `access_token_rotated_at` is
 * stamped. Use this directly to rotate immediately after a suspected
 * compromise.
 *
 * The invalidate call is the point of no return: once Plaid answers, the old
 * token is dead whether or not we manage to store its replacement, so losing
 * the new token here bricks the connection until the user re-links. Everything
 * after that call is therefore retried, and a persist that still fails is
 * logged as a token-loss event and marks the item `error` so the user is told
 * to reconnect instead of watching syncs fail silently. A failure *before*
 * Plaid answers leaves the old token working, so rotation never breaks a sync
 * on its own.
 *
 * Rotation takes the same per-item claim a sync does. Without it, invalidating
 * the token while a webhook- or cron-triggered sync is mid-flight kills that
 * run's token underneath it, which surfaces to the user as a spurious "bank
 * disconnected" alert. Rotation is periodic and best-effort, so if the item is
 * busy we simply leave it for the next daily pass.
 */
export async function rotateItemAccessToken(item: PlaidItemRow): Promise<boolean> {
  const claimClient = createServiceClient();
  const { data: claimed, error: claimError } = await claimClient.rpc(
    "claim_item_sync",
    { p_item_id: item.id, p_stale_seconds: STALE_CLAIM_SECONDS },
  );
  if (claimError) {
    // Can't prove the item is idle, so don't risk pulling the token out from
    // under an in-flight sync.
    logError("plaid-service.token-rotation-claim", claimError);
    return false;
  }
  if (claimed !== true) return false;

  try {
    return await rotateClaimedItemAccessToken(item);
  } finally {
    try {
      await claimClient.rpc("release_item_sync", { p_item_id: item.id });
    } catch (error) {
      logError("plaid-service.token-rotation-release", error);
    }
  }
}

async function rotateClaimedItemAccessToken(
  item: PlaidItemRow,
): Promise<boolean> {
  const plaintext = decryptItemToken(item);
  let newToken: string | null | undefined;
  try {
    const plaid = getPlaidClient();
    const response = await plaid.itemAccessTokenInvalidate({
      access_token: plaintext,
    });
    newToken = response.data.new_access_token;
  } catch (error) {
    // Old token still valid, so nothing was rotated.
    logError("plaid-service.token-rotation", error);
    return false;
  }

  if (!newToken) {
    // Plaid invalidated the old token but gave us nothing to replace it with.
    logError(
      "plaid-service.token-rotation-lost",
      new Error(`Plaid returned no new access token for item ${item.id}`),
    );
    await markItemTokenLost(item.user_id, item.id);
    return false;
  }

  const enc = encryptSecret(newToken);
  const supabase = createServiceClient();
  for (let attempt = 0; attempt < PERSIST_RETRIES; attempt += 1) {
    const { error } = await supabase
      .from("plaid_items")
      .update({
        access_token_ciphertext: enc.ciphertext,
        access_token_iv: enc.iv,
        access_token_tag: enc.tag,
        access_token_rotated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (!error) return true;
    logError("plaid-service.token-rotation-persist", error);
  }

  logError(
    "plaid-service.token-rotation-lost",
    new Error(`Could not persist rotated access token for item ${item.id}`),
  );
  await markItemTokenLost(item.user_id, item.id);
  return false;
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
