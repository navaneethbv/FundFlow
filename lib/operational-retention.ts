import type { SupabaseClient } from "@supabase/supabase-js";

/** Owner-scoped retention. Security and exact-event tombstones remain durable. */
export async function pruneOperationalData(service: SupabaseClient, userId: string, now = Date.now()) {
  const cutoff = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const results = await Promise.all([
    service.from("audit_logs").delete().eq("user_id", userId).lt("created_at", cutoff(365)),
    service.from("data_exports").delete().eq("user_id", userId).lt("created_at", cutoff(90)),
    service.from("sync_jobs").delete().eq("user_id", userId).neq("status", "running").lt("created_at", cutoff(30)),
    // Never erase revocation tombstones: an old refresh token could recreate the session.
    service.from("user_session_records").delete().eq("user_id", userId).is("revoked_at", null).lt("last_seen_at", cutoff(90)),
    // Exact subjects are the replay barrier for goals and transaction alerts.
    service.from("notifications").delete().eq("user_id", userId).is("subject_key", null).lt("created_at", cutoff(90)),
  ]);
  const errors = results.map((result) => result.error).filter(Boolean);
  if (errors.length) throw new AggregateError(errors, "Operational retention failed");
}
