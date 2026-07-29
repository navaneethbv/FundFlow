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

// Order matters: Edge UAs also contain "Chrome", and iPadOS reports "Macintosh",
// so the more specific pattern must come first. First match wins.
const OS_PATTERNS: [RegExp, string][] = [
  [/Windows/i, "Windows"],
  [/Macintosh|Mac OS/i, "macOS"],
  [/iPhone|iPad/i, "iOS"],
  [/Android/i, "Android"],
  [/Linux/i, "Linux"],
];
const BROWSER_PATTERNS: [RegExp, string][] = [
  [/Edg\//i, "Edge"],
  [/Chrome\//i, "Chrome"],
  [/Firefox\//i, "Firefox"],
  [/Safari\//i, "Safari"],
];

function matchLabel(userAgent: string, patterns: [RegExp, string][], fallback: string): string {
  return patterns.find(([re]) => re.test(userAgent))?.[1] ?? fallback;
}

/** "Mozilla/5.0 (Macintosh; ...) ... Safari/605.1" → coarse device label. */
export function summarizeUserAgent(userAgent: string): string {
  const os = matchLabel(userAgent, OS_PATTERNS, "Unknown OS");
  const browser = matchLabel(userAgent, BROWSER_PATTERNS, "Unknown browser");
  return `${browser} on ${os}`;
}
