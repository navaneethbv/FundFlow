import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncAllForUser } from "@/lib/sync";
import { syncInvestmentsForUser } from "@/lib/investment-sync";
import { syncCreditCardLiabilitiesForUser } from "@/lib/liabilities-sync";
import { rotateStaleItemTokens } from "@/lib/plaid-service";
import { refreshRecurringForUser } from "@/lib/recurring";
import { errorResponse, requireCronAuth } from "@/lib/http";
import { logError } from "@/lib/log";
import { writeNetWorthSnapshot } from "@/lib/net-worth";
import { syncCardAprsForUser } from "@/lib/liabilities";
import { runIntegrityChecks } from "@/lib/integrity";
import { processNotificationsForUser } from "@/lib/notifications";
import { sendDailyDigestEmail } from "@/lib/reporting";
import { alertCronFailure } from "@/lib/cron-alert";
import { writeDailyAccountSnapshots } from "@/lib/account-history";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { dateKeyInTimezone } from "@/lib/report-period";
import { promoteDueScheduledTransactions } from "@/lib/scheduled-promotion";

export const dynamic = "force-dynamic";
// Raised from 60: investment holdings sync (Phase 9A) adds one more
// per-item Plaid round trip to every user's daily run.
export const maxDuration = 300;

/** Reduce an exception to a safe token for the alert email: a Plaid-style
 *  UPPER_SNAKE code if the message is one, otherwise the error's class name. */
function safeSyncError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/^[A-Z0-9_]{3,60}$/.test(message)) return message;
  return err instanceof Error ? err.name : "unknown_error";
}

async function runOptionalSync(
  label: string,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    logError(label, error);
  }
}

async function sendDailyDigest(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<void> {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const [{ data: profile, error: profileError }, { data: todayNotifications, error: notificationError }] =
      await Promise.all([
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
    const digestNotifications =
      profile?.daily_digest_email_enabled === false
        ? (todayNotifications ?? []).filter((notification) => notification.type === "broken_bank")
        : (todayNotifications ?? []);
    if (digestNotifications.length === 0) return;
    const { data: userData } = await service.auth.admin.getUserById(userId);
    const email = userData?.user?.email;
    if (!email) return;
    await sendDailyDigestEmail(
      email,
      digestNotifications,
      new Date().toISOString().slice(0, 10),
      `${serverEnv.appUrl ?? "http://localhost:3000"}/notifications`,
    );
  } catch (error) {
    logError("cron.sync.digest", error);
    if (error instanceof Error && error.message.includes("SMTP is not configured")) {
      await service.from("notifications").insert({
        user_id: userId,
        type: "broken_bank",
        severity: "danger",
        title: "Daily digest email skipped",
        body: "We could not send your daily digest email because SMTP is not configured in production settings.",
      });
    }
  }
}

async function syncUser(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<void> {
  await syncAllForUser(userId);
  await runOptionalSync("cron.sync.token-rotation", () => rotateStaleItemTokens(userId));
  if (isFeatureEnabled("investmentsPage")) {
    let today = dateKeyInTimezone(new Date(), null);
    try {
      const { data: profile, error: profileError } = await service
        .from("profiles")
        .select("timezone")
        .eq("id", userId)
        .maybeSingle();
      if (profileError) throw profileError;
      today = dateKeyInTimezone(new Date(), profile?.timezone);
    } catch (profileError) {
      logError("cron.sync.profile-timezone", profileError);
    }
    await runOptionalSync("cron.sync.investments", () =>
      syncInvestmentsForUser(userId, today),
    );
  }
  if (isFeatureEnabled("liabilitiesSync")) {
    await runOptionalSync("cron.sync.liabilities", () =>
      syncCreditCardLiabilitiesForUser(userId),
    );
  }
  await writeDailyAccountSnapshots(userId);
  await refreshRecurringForUser(userId);
  await writeNetWorthSnapshot(userId);
  await runOptionalSync("cron.sync.aprs", () => syncCardAprsForUser(userId));
  await processNotificationsForUser(userId);
  await sendDailyDigest(service, userId);
}

async function syncUsers(
  service: ReturnType<typeof createServiceClient>,
  userIds: string[],
): Promise<{ synced: number; failures: string[] }> {
  let synced = 0;
  const failures: string[] = [];
  for (const userId of userIds) {
    try {
      await syncUser(service, userId);
      synced += 1;
    } catch (error) {
      logError("cron.sync.user", error);
      failures.push(safeSyncError(error));
    }
  }
  return { synced, failures };
}

/**
 * Scheduled daily sync for every user with active bank connections.
 * Protected by CRON_SECRET: Vercel Cron sends "Authorization: Bearer <secret>"
 * when the CRON_SECRET env var is set.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const service = createServiceClient();
    const { data, error } = await service
      .from("plaid_items")
      .select("user_id")
      .eq("status", "active");
    if (error) throw error;

    const userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];

    const { synced, failures } = await syncUsers(service, userIds);

    // Scheduled-transaction promotion runs for everyone (manual-only users
    // have no plaid_items row, so it cannot ride the per-user loop). Best
    // effort: a failure is logged, never blocks the sync.
    await runOptionalSync("cron.sync.scheduled-promotion", () =>
      promoteDueScheduledTransactions(service, dateKeyInTimezone(new Date(), null)),
    );

    // Data-integrity pass (2.3, best-effort): stuck jobs, orphaned
    // transactions, duplicate Plaid ids. Bounded queries per user; findings
    // go to the admin through the same deduped alert rail as cron failures.
    try {
      const integrityFindings: string[] = [];
      for (const userId of userIds) {
        const [{ data: jobs }, { data: txns }, { data: accts }] = await Promise.all([
          service
            .from("sync_jobs")
            .select("status, updated_at")
            .eq("user_id", userId)
            .eq("status", "running"),
          service
            .from("transactions")
            .select("id, account_id, plaid_transaction_id, pending, date")
            .eq("user_id", userId),
          service.from("accounts").select("id").eq("user_id", userId),
        ]);
        const findings = runIntegrityChecks({
          nowMs: Date.now(),
          syncJobs: (jobs ?? []).map((j) => ({
            status: j.status as string,
            updatedAt: j.updated_at as string,
          })),
          transactions: (txns ?? []).map((t) => ({
            id: t.id as string,
            accountId: t.account_id as string | null,
            plaidTransactionId: t.plaid_transaction_id as string | null,
            pending: Boolean(t.pending),
            date: t.date as string,
          })),
          accountIds: (accts ?? []).map((a) => a.id as string),
        });
        for (const finding of findings) integrityFindings.push(finding.detail);
      }
      if (integrityFindings.length > 0) {
        await alertCronFailure("integrity", {
          failed: integrityFindings.length,
          total: userIds.length,
          firstError: integrityFindings[0],
        });
      }
    } catch (integrityErr) {
      logError("cron.sync.integrity", integrityErr);
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
      firstError: safeSyncError(error),
    });
    return errorResponse("cron.sync", error);
  }
}
