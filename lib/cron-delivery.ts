import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/log";

/** Serializes delivery across invocations. Only a successful send advances the window. */
export async function withCronDelivery(
  service: SupabaseClient,
  key: string,
  userId: string | null,
  skipAfter: string,
  deliver: (previous: string | null) => Promise<string | null>,
): Promise<void> {
  const claimId = randomUUID();
  const { data, error } = await service.rpc("claim_cron_delivery", {
    p_key: key, p_user_id: userId, p_claim_id: claimId, p_skip_after: skipAfter,
  });
  if (error) throw error;
  if (!data?.length) return;

  let sentThrough: string | null = null;
  try {
    sentThrough = await deliver(data[0].sent_through);
  } finally {
    try {
      const update = service.from("cron_delivery_windows").update({
        claim_id: null,
        claim_expires_at: null,
        ...(sentThrough && { sent_through: sentThrough }),
      }).eq("delivery_key", key).eq("claim_id", claimId);
      const scoped = userId === null ? update.is("user_id", null) : update.eq("user_id", userId);
      const { data: rows, error: updateError } = await scoped.select("delivery_key");
      if (updateError) throw updateError;
      if (!rows?.length) throw new Error("CRON_DELIVERY_CLAIM_LOST");
    } catch (error) {
      if (sentThrough) throw error;
      logError("cron.delivery.release", error);
    }
  }
}


/** Records authenticated scheduler activity even when no delivery was due. */
export async function recordSchedulerRun(job: "weekly-report" | "backup", service?: SupabaseClient) {
  try {
    const { error } = await (service ?? createServiceClient()).from("cron_delivery_windows").upsert({
      delivery_key: `scheduler:${job}`, sent_through: new Date().toISOString(),
    }, { onConflict: "delivery_key" });
    if (error) throw error;
  } catch (error) {
    logError("cron.scheduler-heartbeat", error);
  }
}
