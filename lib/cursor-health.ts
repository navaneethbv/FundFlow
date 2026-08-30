import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Item-scoped cursor health: the durable facts that let Settings explain why
 * an institution's transaction history may be incomplete. Recorded on the
 * plaid_items row next to sync_cursor by lib/sync.ts, and derived into a
 * single actionable state by deriveCursorHealth.
 */

const SAFE_ERROR_CODES = new Set([
  "ADDITIONAL_CONSENT_REQUIRED",
  "INSTITUTION_DOWN",
  "INSTITUTION_NOT_RESPONDING",
  "INVALID_PRODUCT",
  "ITEM_LOGIN_REQUIRED",
  "NO_INVESTMENT_ACCOUNTS",
  "PENDING_EXPIRATION",
  "PRODUCT_NOT_READY",
  "PRODUCTS_NOT_SUPPORTED",
  "RATE_LIMIT",
  "RATE_LIMIT_EXCEEDED",
  "TOKEN_ROTATION_LOST",
  "no_investment_product",
  "product_not_ready",
  "rate_limited",
]);

export function safeErrorCode(value: string | null): string | null {
  return value && SAFE_ERROR_CODES.has(value) ? value : null;
}

export type CursorHealthState =
  | "healthy"
  | "partial_page"
  | "backfill_incomplete"
  | "cursor_reset"
  | "failed"
  | "never_synced";

export interface ItemCursorHealth {
  plaidItemId: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSyncCompletedPages: boolean;
  initialHistoryIncomplete: boolean;
  cursorResetDetectedAt: string | null;
  safeErrorCode: string | null;
  state: CursorHealthState;
}

export interface CursorHealthInput {
  plaidItemId: string;
  itemStatus: string;
  itemErrorCode: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSyncCompletedPages: boolean;
  initialHistoryIncomplete: boolean;
  cursorResetDetectedAt: string | null;
  now: Date;
}

function validTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Classify an item's cursor health from its stored facts. Precedence:
 * a provider failure, then a detected cursor reset, then an incomplete
 * initial backfill, then a successful sync that stopped before the last page.
 * `failed` also covers an attempted run that never recorded a success.
 */
export function deriveCursorHealth(input: CursorHealthInput): ItemCursorHealth {
  const safeError = safeErrorCode(input.itemErrorCode);
  const base = {
    plaidItemId: input.plaidItemId,
    lastAttemptAt: input.lastAttemptAt,
    lastSuccessAt: input.lastSuccessAt,
    lastSyncCompletedPages: input.lastSyncCompletedPages,
    initialHistoryIncomplete: input.initialHistoryIncomplete,
    cursorResetDetectedAt: input.cursorResetDetectedAt,
    safeErrorCode: safeError,
  };

  let state: CursorHealthState;
  if (input.itemStatus !== "active" || safeError) {
    state = "failed";
  } else if (input.cursorResetDetectedAt) {
    state = "cursor_reset";
  } else if (input.initialHistoryIncomplete) {
    state = "backfill_incomplete";
  } else if (!input.lastAttemptAt) {
    state = "never_synced";
  } else if (!input.lastSuccessAt) {
    state = "failed";
  } else if (!input.lastSyncCompletedPages) {
    state = "partial_page";
  } else {
    // Success that drained every page and recorded a parseable timestamp.
    state = validTimestamp(input.lastSuccessAt) ? "healthy" : "partial_page";
  }
  return { ...base, state };
}

interface CursorHealthRecord {
  userId: string;
  itemDbId: string;
  nowIso: string;
}

/** Stamp the start of a sync attempt, scoped to the owning user and item. */
export async function recordCursorAttempt(
  supabase: SupabaseClient,
  input: CursorHealthRecord,
): Promise<void> {
  const { error } = await supabase
    .from("plaid_items")
    .update({ last_sync_attempt_at: input.nowIso })
    .eq("id", input.itemDbId)
    .eq("user_id", input.userId);
  if (error) throw error;
}

/** Record a full, error-free sync that drained every page. */
export async function recordCursorSuccess(
  supabase: SupabaseClient,
  input: CursorHealthRecord,
): Promise<void> {
  const { error } = await supabase
    .from("plaid_items")
    .update({
      last_sync_success_at: input.nowIso,
      last_sync_completed_pages: true,
      initial_history_incomplete: false,
      cursor_reset_detected_at: null,
    })
    .eq("id", input.itemDbId)
    .eq("user_id", input.userId);
  if (error) throw error;
}

interface CursorFailureRecord extends CursorHealthRecord {
  startedWithoutCursor: boolean;
  priorSuccess: boolean;
}

/**
 * Record an interrupted sync. When the run started with no cursor we cannot
 * tell an interrupted initial backfill from a legitimately cleared cursor,
 * so both facts are recorded: the incomplete history flag, and (only when a
 * prior successful sync established a cursor first) the reset detection.
 */
export async function recordCursorFailure(
  supabase: SupabaseClient,
  input: CursorFailureRecord,
): Promise<void> {
  const changes: Record<string, string | boolean> = {
    last_sync_completed_pages: false,
  };
  if (input.startedWithoutCursor) {
    changes.initial_history_incomplete = true;
    if (input.priorSuccess) {
      changes.cursor_reset_detected_at = input.nowIso;
    }
  }
  const { error } = await supabase
    .from("plaid_items")
    .update(changes)
    .eq("id", input.itemDbId)
    .eq("user_id", input.userId);
  if (error) throw error;
}

/**
 * Record a run that completed without error but stopped before has_more
 * became false (a bounded repair backfill). The run made real progress, so
 * `last_sync_success_at` is stamped, but the item must not be presented as
 * fully synced until a later run drains the remaining pages.
 */
export async function recordCursorPartialSuccess(
  supabase: SupabaseClient,
  input: CursorFailureRecord,
): Promise<void> {
  const changes: Record<string, string | boolean> = {
    last_sync_success_at: input.nowIso,
    last_sync_completed_pages: false,
  };
  if (input.startedWithoutCursor) {
    changes.initial_history_incomplete = true;
    if (input.priorSuccess) {
      changes.cursor_reset_detected_at = input.nowIso;
    }
  }
  const { error } = await supabase
    .from("plaid_items")
    .update(changes)
    .eq("id", input.itemDbId)
    .eq("user_id", input.userId);
  if (error) throw error;
}
