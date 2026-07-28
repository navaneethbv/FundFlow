import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendLoginAlertEmail } from "@/lib/reporting";
import { logError } from "@/lib/log";

/**
 * New-device login alerts (7.1). Called when a session record is first
 * created; emails the account owner if the user agent has never been seen
 * on this account before. Best-effort and rate-limited (3/day) — an alert
 * failure must never affect the request that triggered it. Only the UA
 * string is compared and only its family is emailed; no IPs are stored or
 * sent (consistent with the no-PII logging discipline).
 */
export async function notifyNewDeviceLogin(
  userId: string,
  email: string | null | undefined,
  userAgent: string | null,
): Promise<void> {
  try {
    if (!email || !userAgent) return;

    const service = createServiceClient();
    const twentySecondsAgo = new Date(Date.now() - 20_000).toISOString();
    const { count } = await service
      .from("user_session_records")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("user_agent", userAgent)
      .lt("created_at", twentySecondsAgo);
    if ((count ?? 0) > 0) return; // known device

    const allowed = await checkRateLimit(`login-alert:${userId}`, 3, 24 * 3600);
    if (!allowed) return;

    await sendLoginAlertEmail(email, summarizeUserAgent(userAgent));
  } catch (error) {
    logError("login-alert", error);
  }
}

/** "Mozilla/5.0 (Macintosh; ...) ... Safari/605.1" → coarse device label. */
export function summarizeUserAgent(userAgent: string): string {
  const os = /Windows/i.test(userAgent)
    ? "Windows"
    : /Macintosh|Mac OS/i.test(userAgent)
      ? "macOS"
      : /iPhone|iPad/i.test(userAgent)
        ? "iOS"
        : /Android/i.test(userAgent)
          ? "Android"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : "Unknown OS";
  const browser = /Edg\//i.test(userAgent)
    ? "Edge"
    : /Chrome\//i.test(userAgent)
      ? "Chrome"
      : /Firefox\//i.test(userAgent)
        ? "Firefox"
        : /Safari\//i.test(userAgent)
          ? "Safari"
          : "Unknown browser";
  return `${browser} on ${os}`;
}
