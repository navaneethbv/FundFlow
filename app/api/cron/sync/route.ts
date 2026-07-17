import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { safeEqual } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { syncAllForUser } from "@/lib/sync";
import { refreshRecurringForUser } from "@/lib/recurring";
import { errorResponse } from "@/lib/http";
import { logError } from "@/lib/log";
import { writeNetWorthSnapshot } from "@/lib/net-worth";
import { processNotificationsForUser } from "@/lib/notifications";
import { sendDailyDigestEmail } from "@/lib/reporting";
import { alertCronFailure } from "@/lib/cron-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled daily sync for every user with active bank connections.
 * Protected by CRON_SECRET: Vercel Cron sends "Authorization: Bearer <secret>"
 * when the CRON_SECRET env var is set.
 */
export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv.cronSecret}`;
  if (!safeEqual(header, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const service = createServiceClient();
    const { data, error } = await service
      .from("plaid_items")
      .select("user_id")
      .eq("status", "active");
    if (error) throw error;

    const userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];

    let synced = 0;
    const failures: string[] = [];
    for (const userId of userIds) {
      try {
        await syncAllForUser(userId);
        await refreshRecurringForUser(userId);
        await writeNetWorthSnapshot(userId);
        await processNotificationsForUser(userId);

        // Daily Digest Email Trigger
        try {
          const todayStart = new Date();
          todayStart.setUTCHours(0, 0, 0, 0);
          const [{ data: profile, error: profileError }, { data: todayNotifications, error: notificationError }] = await Promise.all([
            service
              .from("profiles")
              .select("daily_digest_email_enabled")
              .eq("id", userId)
              .maybeSingle(),
            service
            .from("notifications")
            .select("type, title, body")
            .eq("user_id", userId)
            .gte("created_at", todayStart.toISOString()),
          ]);
          if (profileError) throw profileError;
          if (notificationError) throw notificationError;

          const digestNotifications = profile?.daily_digest_email_enabled === false
            ? (todayNotifications ?? []).filter((notification) => notification.type === "broken_bank")
            : (todayNotifications ?? []);

          if (digestNotifications.length > 0) {
            const { data: userData } = await service.auth.admin.getUserById(userId);
            const email = userData?.user?.email;
            if (email) {
              const dateStr = new Date().toISOString().slice(0, 10);
              await sendDailyDigestEmail(
                email,
                digestNotifications,
                dateStr,
                `${serverEnv.appUrl ?? "http://localhost:3000"}/notifications`,
              );
            }
          }
        } catch (digestErr) {
          logError("cron.sync.digest", digestErr);
          if (digestErr instanceof Error && digestErr.message.includes("SMTP is not configured")) {
            await service.from("notifications").insert({
              user_id: userId,
              type: "broken_bank",
              severity: "danger",
              title: "Daily digest email skipped",
              body: "We could not send your daily digest email because SMTP is not configured in production settings.",
            });
          }
        }

        synced += 1;
      } catch (err) {
        logError("cron.sync.user", err);
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }

    // Housekeeping (best-effort): drop sync_jobs history older than 30 days
    // and rate-limit windows that closed more than a day ago.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [jobsPrune, countersPrune] = await Promise.all([
      service.from("sync_jobs").delete().lt("created_at", thirtyDaysAgo),
      service.from("rate_limit_counters").delete().lt("window_start", oneDayAgo),
    ]);
    if (jobsPrune.error) logError("cron.sync.prune.jobs", jobsPrune.error);
    if (countersPrune.error) logError("cron.sync.prune.counters", countersPrune.error);

    if (failures.length > 0) {
      await alertCronFailure("daily-sync", {
        failed: failures.length,
        total: userIds.length,
        firstError: failures[0],
      });
    }

    return NextResponse.json({ ok: true, users: userIds.length, synced });
  } catch (error) {
    await alertCronFailure("daily-sync", {
      failed: 1,
      total: 1,
      firstError: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("cron.sync", error);
  }
}
