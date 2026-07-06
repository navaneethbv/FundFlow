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
  | "data_refresh"
  | "data_export"
  | "account_delete";

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
