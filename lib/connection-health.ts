import type { InstitutionSyncHealth } from "@/lib/sync-health";
export interface ConnectionItem {
  id: string;
  institution_name: string | null;
  status: string;
  error_code: string | null;
}
export type ConnectionState =
  "reconnect" | "sync_error" | "account_review" | "healthy";
export interface ConnectionHealthRow {
  id: string;
  name: string;
  state: ConnectionState;
  linkedAccounts: number;
  pendingReviews: number;
  lastSuccessAt: string | null;
  detail: string;
}
const RECONNECT_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "PENDING_EXPIRATION",
  "ADDITIONAL_CONSENT_REQUIRED",
  "TOKEN_ROTATION_LOST",
]);
const SYNC_ATTENTION = new Set([
  "stale",
  "repair_required",
  "rate_limited",
  "never_synced",
]);
export function summarizeConnection(
  item: ConnectionItem,
  health: InstitutionSyncHealth,
  linkedAccounts: number,
  pendingReviews: number,
): ConnectionHealthRow {
  const codes = [
    item.error_code,
    health.transactions.safeErrorCode,
    health.investments.safeErrorCode,
  ];
  let state: ConnectionState = "healthy";
  let detail = "Recorded syncs are current.";
  if (codes.some((code) => code !== null && RECONNECT_CODES.has(code))) {
    state = "reconnect";
    detail = "Bank authorization needs attention.";
  } else if (
    item.status !== "active" ||
    SYNC_ATTENTION.has(health.transactions.state) ||
    ["stale", "repair_required", "rate_limited"].includes(
      health.investments.state,
    ) ||
    (health.cursor !== null &&
      health.cursor.state !== "healthy" &&
      health.cursor.state !== "never_synced")
  ) {
    state = "sync_error";
    detail =
      "A sync failed, is incomplete, or has no recent successful completion.";
  } else if (pendingReviews > 0 || linkedAccounts === 0) {
    state = "account_review";
    detail =
      pendingReviews > 0
        ? "Provider balances need your review."
        : "No linked accounts have been recorded for this connection.";
  }
  return {
    id: item.id,
    name: item.institution_name ?? "Bank",
    state,
    linkedAccounts,
    pendingReviews,
    lastSuccessAt: health.transactions.lastSuccessAt,
    detail,
  };
}
