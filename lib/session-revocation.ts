import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeSessionId } from "@/lib/session-token";
import { logError } from "@/lib/log";

/**
 * True when the current request's session has been revoked from the Settings
 * device list. Lookup failures are rethrown after logging so the proxy can
 * return temporary unavailability instead of authorizing an unverified page.
 */
export async function isSessionRevoked(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const session = data?.session;
    const sessionId = decodeSessionId(session?.access_token);
    if (!sessionId) return false;
    const { data: record, error } = await supabase
      .from("user_session_records")
      .select("revoked_at")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .maybeSingle();
    if (error) throw error;
    return Boolean(record?.revoked_at);
  } catch (error) {
    logError("session-revocation.lookup", error);
    throw error;
  }
}
