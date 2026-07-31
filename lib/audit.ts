import "server-only";
import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/log";

/** Sensitive actions we record in audit_logs. */
export type AuditAction =
  | "login"
  | "logout"
  | "signup"
  | "mfa_enroll"
  | "mfa_unenroll"
  | "plaid_connect"
  | "plaid_token_exchange"
  | "plaid_disconnect"
  | "plaid_reconnect"
  | "data_refresh"
  | "data_export"
  | "data_import"
  | "account_delete"
  | "calendar_token_created"
  | "calendar_token_revoked"
  | "data_backup"
  | "household_invite_sent"
  | "household_invite_accepted"
  | "apr_updated"
  | "api_token_created"
  | "api_token_revoked"
  | "receipt_scanned"
  | "ai_question"
  | "household_share_changed"
  | "manual_account_created"
  | "manual_account_updated"
  | "manual_account_deleted"
  | "budget_updated"
  | "budget_proposals_created"
  | "demo_data_loaded"
  | "demo_data_cleared"
  | "recurring_stream_reviewed"
  | "recurring_stream_dismissed"
  | "recurring_stream_restored"
  | "recurring_stream_amount_corrected"
  | "manual_recurring_item_created"
  | "manual_recurring_item_updated"
  | "manual_recurring_item_deleted"
  | "saved_report_created"
  | "saved_report_updated"
  | "saved_report_deleted"
  | "goal_allocation_set"
  | "goal_allocation_removed"
  | "goal_contribution_recorded"
  | "goal_contribution_removed"
  | "goal_transaction_linked"
  | "manual_holding_created"
  | "manual_holding_deleted"
  | "advice_task_toggled"
  | "advice_priorities_updated"
  | "advice_profile_updated"
  | "manual_transaction_created"
  | "manual_transaction_deleted"
  | "tag_renamed"
  | "tag_merged"
  | "tag_deleted"
  | "profile_updated"
  | "avatar_updated"
  | "display_prefs_updated";

interface AuditParams {
  userId: string | null;
  action: AuditAction;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Best-effort audit write. Uses the service client (audit_logs has no client
 * insert policy). Metadata must NOT contain tokens or PII. Never throws: a
 * failed audit write must not break the user action.
 */
export async function writeAudit({
  userId,
  action,
  metadata = {},
  ip = null,
}: AuditParams): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action,
      metadata,
      ip,
    });
  } catch (error) {
    logError("audit.write", error);
  }
}

/** Extract a best-effort client IP from proxy headers. */
export function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip");
}
