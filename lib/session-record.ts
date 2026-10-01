import type { SupabaseClient } from "@supabase/supabase-js";

/** Insert ownership is the notification claim; recent timestamps are not. */
export async function recordSession(
  supabase: SupabaseClient, userId: string, sessionId: string, userAgent: string | null,
) {
  const read = () => supabase.from("user_session_records")
    .select("revoked_at, last_seen_at").eq("user_id", userId).eq("session_id", sessionId).maybeSingle();
  const existing = await read();
  if (existing.error) throw existing.error;
  let record = existing.data;
  let created = false;
  if (!record) {
    const inserted = await supabase.from("user_session_records").upsert({
      user_id: userId, session_id: sessionId, user_agent: userAgent,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "user_id,session_id", ignoreDuplicates: true })
      .select("revoked_at, last_seen_at").maybeSingle();
    if (inserted.error) throw inserted.error;
    created = Boolean(inserted.data);
    if (created) record = inserted.data;
    else {
      const raced = await read();
      if (raced.error) throw raced.error;
      record = raced.data;
    }
  }
  if (!record) throw new Error("Session record unavailable");
  if (!record.revoked_at && !created && Date.now() - Date.parse(record.last_seen_at) >= 300_000) {
    const { error } = await supabase.from("user_session_records")
      .update({ last_seen_at: new Date().toISOString() }).eq("user_id", userId)
      .eq("session_id", sessionId).is("revoked_at", null)
      .lt("last_seen_at", new Date(Date.now() - 300_000).toISOString());
    if (error) throw error;
  }
  return { revoked: Boolean(record.revoked_at), created };
}
