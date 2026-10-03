import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/log";

/**
 * Reports-only members may receive the aggregate RPC, but must never reach a
 * service-client path that returns raw household rows. A database error fails
 * closed so an authorization lookup cannot widen access during an outage.
 */
export async function isReportsOnlyMember(
  service: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    const { data, error } = await service
      .from("household_members")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "reports_only")
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  } catch (error) {
    logError("household.reports-only-lookup", error);
    return true;
  }
}
