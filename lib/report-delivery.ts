import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeeklyReportPeriod } from "@/lib/report-period";

const STALE_PROCESSING_MS = 60 * 60 * 1000;

export type DeliveryClaim = "claim" | "retry" | "skip";

export function classifyDeliveryClaim(
  existing: { status: string; attemptedAt: string } | null,
  now: Date,
): DeliveryClaim {
  if (!existing) return "claim";
  if (existing.status === "sent" || existing.status === "skipped") return "skip";
  if (existing.status === "failed") return "retry";
  if (existing.status !== "processing") return "skip";
  const attemptedAt = new Date(existing.attemptedAt).getTime();
  return Number.isFinite(attemptedAt) && now.getTime() - attemptedAt >= STALE_PROCESSING_MS
    ? "retry"
    : "skip";
}

export async function claimWeeklyDelivery(
  supabase: SupabaseClient,
  userId: string,
  period: WeeklyReportPeriod,
  now: Date,
): Promise<{ claimed: boolean; deliveryId?: string }> {
  const attemptedAt = now.toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("weekly_report_deliveries")
    .insert({
      user_id: userId,
      period_start: period.start,
      period_end: period.end,
      status: "processing",
      attempted_at: attemptedAt,
    })
    .select("id")
    .single();

  if (!insertError && inserted) {
    return { claimed: true, deliveryId: inserted.id as string };
  }
  if (insertError?.code !== "23505") throw insertError;

  const { data: existing, error: existingError } = await supabase
    .from("weekly_report_deliveries")
    .select("id, status, attempted_at")
    .eq("user_id", userId)
    .eq("period_start", period.start)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) return { claimed: false };

  const decision = classifyDeliveryClaim(
    { status: existing.status as string, attemptedAt: existing.attempted_at as string },
    now,
  );
  if (decision !== "retry") return { claimed: false };

  const { data: updated, error: updateError } = await supabase
    .from("weekly_report_deliveries")
    .update({
      status: "processing",
      attempted_at: attemptedAt,
      provider_message_id: null,
      error_code: null,
      sent_at: null,
    })
    .eq("id", existing.id as string)
    .eq("user_id", userId)
    .eq("attempted_at", existing.attempted_at as string)
    .select("id")
    .maybeSingle();
  if (updateError) throw updateError;
  return updated
    ? { claimed: true, deliveryId: updated.id as string }
    : { claimed: false };
}

export async function markWeeklyDeliverySent(
  supabase: SupabaseClient,
  userId: string,
  deliveryId: string,
  providerMessageId: string | null,
  sentAt: Date,
): Promise<void> {
  const { error } = await supabase
    .from("weekly_report_deliveries")
    .update({
      status: "sent",
      provider_message_id: providerMessageId,
      sent_at: sentAt.toISOString(),
      error_code: null,
    })
    .eq("id", deliveryId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function markWeeklyDeliveryFailed(
  supabase: SupabaseClient,
  userId: string,
  deliveryId: string,
  errorCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("weekly_report_deliveries")
    .update({ status: "failed", error_code: errorCode.slice(0, 80) })
    .eq("id", deliveryId)
    .eq("user_id", userId);
  if (error) throw error;
}
