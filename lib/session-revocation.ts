import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeSessionId } from "@/lib/session-token";
import { logError } from "@/lib/log";

/**
 * True when the current request's session has been revoked from the Settings
 * device list. Fails OPEN (false) on any lookup problem: a transient DB error
 * must not lock the user out of the whole app. Enforcement mirrors
 * requireUser() in lib/http.ts, which gates APIs; this gates page renders.
 */
export async function isSessionRevoked(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const sessionId = decodeSessionId(session?.access_token);
    if (!sessionId) return false;
    const { data: record } = await supabase
      .from("user_session_records")
      .select("revoked_at")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .maybeSingle();
    return Boolean(record?.revoked_at);
  } catch (error) {
    logError("session-revocation.lookup", error);
    return false;
  }
}
