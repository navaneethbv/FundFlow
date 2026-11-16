import { withCronDelivery } from "@/lib/cron-delivery";
import { bankIdFromBrokenBankSubject, brokenBankDetails, requiresPlaidUserAction } from "@/lib/plaid-item-health";
import { INSIGHT_TYPES } from "@/lib/insight-types";
import { pruneOperationalData } from "@/lib/operational-retention";
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
import { loadMaintenanceUsers } from "@/lib/maintenance-users";
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

type DigestNotificationRow = {
  type: string;
  title: string;
  body: string;
  subject_key: string | null;
};

async function loadDigestNotifications(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  since: string,
  through: string,
  digestEnabled: boolean,
): Promise<DigestNotificationRow[]> {
  const notifications: DigestNotificationRow[] = [];
  const loadPage = async (offset: number): Promise<void> => {
    const { data, error } = await service.from("notifications")
      .select("type, title, body, subject_key").eq("user_id", userId)
      .gt("created_at", since).lte("created_at", through)
      .order("created_at").order("id").range(offset, offset + 999);
    if (error) throw error;
    const rows = (data ?? []) as DigestNotificationRow[];
    notifications.push(...rows.filter((row) => digestEnabled
      ? row.type !== "rule_match" && !(INSIGHT_TYPES as readonly string[]).includes(row.type)
      : row.type === "broken_bank"));
    if (rows.length >= 1000) return loadPage(offset + 1000);
  };
  await loadPage(0);
  return notifications;
}

async function loadBrokenBankIssues(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  itemIds: string[],
): Promise<Map<string, ReturnType<typeof brokenBankDetails>>> {
  const chunks: string[][] = [];
  for (let offset = 0; offset < itemIds.length; offset += 100) {
    chunks.push(itemIds.slice(offset, offset + 100));
  }
  const batches = await Promise.all(chunks.map(async (chunk) => {
    const { data, error } = await service.from("plaid_items")
      .select("id, institution_name, error_code").eq("user_id", userId).eq("status", "error")
      .in("id", chunk);
    if (error) throw error;
    return data ?? [];
  }));
  const currentIssues = new Map<string, ReturnType<typeof brokenBankDetails>>();
  for (const item of batches.flat()) {
    if (requiresPlaidUserAction(item.error_code)) {
      currentIssues.set(item.id, brokenBankDetails(item.institution_name, item.error_code));
    }
  }
  return currentIssues;
}

function selectDeliverableAlerts(
  notifications: DigestNotificationRow[],
  currentIssues: Map<string, ReturnType<typeof brokenBankDetails>>,
): Array<{ type: string; title: string; body: string }> {
  const bankAlertsSeen = new Set<string>();
  return notifications.flatMap(({ type, title, body, subject_key }) => {
    if (type !== "broken_bank") return [{ type, title, body }];
    const itemId = bankIdFromBrokenBankSubject(subject_key);
    if (itemId === null || bankAlertsSeen.has(itemId)) return [];
    const issue = currentIssues.get(itemId);
    if (!issue) return [];
    bankAlertsSeen.add(itemId);
    return [{ type, ...issue }];
  });
}

async function sendDailyDigest(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<void> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const through = now.toISOString();
  try {
    const { data: profile, error: profileError } = await service.from("profiles")
      .select("daily_digest_email_enabled").eq("id", userId).maybeSingle();
    if (profileError) throw profileError;

    await withCronDelivery(service, `digest:${userId}`, userId, todayStart.toISOString(), async (previous) => {
      const floor = new Date(now.getTime() - 48 * 3_600_000).toISOString();
      // Use the durable high-water mark, with a bounded catch-up window.
      const since = previous && previous > floor ? previous : floor;
      const notifications = await loadDigestNotifications(
        service, userId, since, through, profile?.daily_digest_email_enabled !== false,
      );
      const itemIds = [...new Set(notifications
        .filter((row) => row.type === "broken_bank")
        .map((row) => bankIdFromBrokenBankSubject(row.subject_key))
        .filter((id): id is string => id !== null))];
      const currentIssues = await loadBrokenBankIssues(service, userId, itemIds);
      const deliverable = selectDeliverableAlerts(notifications, currentIssues);
      if (deliverable.length === 0) return null;
      const { data: userData, error: userError } = await service.auth.admin.getUserById(userId);
      if (userError) throw userError;
      const email = userData?.user?.email;
      if (!email) return null;
      await sendDailyDigestEmail(email, deliverable, through.slice(0, 10),
        `${serverEnv.appUrl ?? "http://localhost:3000"}/notifications`);
      return through;
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("SMTP is not configured")) {
      await alertCronFailure("digest-delivery", { failed: 1, total: 1, firstError: "SMTP_NOT_CONFIGURED" });
    }
    throw error;
  }
}

/** PostgREST max_rows is 1,000: page so the integrity pass sees every row. */
const CRON_TXN_PAGE_SIZE = 1_000;

async function loadUserTransactions(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<Array<{ id: string; accountId: string | null; plaidTransactionId: string | null; pending: boolean; date: string }>> {
  const rows: Array<{ id: string; accountId: string | null; plaidTransactionId: string | null; pending: boolean; date: string }> = [];
  for (let page = 0; ; page += 1) {
    const from = page * CRON_TXN_PAGE_SIZE;
    const { data, error } = await service
      .from("transactions")
      .select("id, account_id, plaid_transaction_id, pending, date")
      .eq("user_id", userId)
      .order("date")
      .order("id")
      .range(from, from + CRON_TXN_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []).map((t) => ({
      id: t.id as string,
      accountId: t.account_id as string | null,
      plaidTransactionId: t.plaid_transaction_id as string | null,
      pending: Boolean(t.pending),
      date: t.date as string,
    }));
    rows.push(...batch);
    if (batch.length < CRON_TXN_PAGE_SIZE) return rows;
  }
}

async function syncUser(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  hasBank: boolean,
  deadline: number,
): Promise<string[]> {
  const stepFailures: string[] = [];
  if (hasBank) {
    try { await syncAllForUser(userId, deadline); } catch (error) { logError("cron.sync.bank", error); stepFailures.push(safeSyncError(error)); }
    if (Date.now() >= deadline) return [...stepFailures, "DEADLINE_EXCEEDED"];
    await runOptionalSync("cron.sync.token-rotation", () => rotateStaleItemTokens(userId));
  }
  // One clock per user for the whole run (M-11): daily snapshots, the
  // net-worth month key, recurring inference, and notifications all share
  // the viewer's profile-timezone day instead of each reading UTC.
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
  if (hasBank && isFeatureEnabled("investmentsPage")) {
    await runOptionalSync("cron.sync.investments", () =>
      syncInvestmentsForUser(userId, today),
    );
  }
  if (hasBank && isFeatureEnabled("liabilitiesSync")) {
    await runOptionalSync("cron.sync.liabilities", () =>
      syncCreditCardLiabilitiesForUser(userId),
    );
  }
  // Per-step isolation (A-10): each post-sync step runs wrapped so one
  // failure no longer skips the rest of this user's run. Step failures are
  // collected and reported in the 207 body by the caller.
  const runUserStep = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
    } catch (error) {
      logError(label, error);
      stepFailures.push(`${label}: ${safeSyncError(error)}`);
    }
  };
  await runUserStep("cron.sync.scheduled-promotion", async () => {
    const result = await promoteDueScheduledTransactions(service, today, userId);
    if (result.failed !== null) {
      logError("cron.sync.scheduled-promotion.result", result.failed);
      throw new Error("SCHEDULED_PROMOTION_FAILED");
    }
  });
  await runUserStep("cron.sync.snapshots", () => writeDailyAccountSnapshots(userId, today));
  await runUserStep("cron.sync.recurring", () => refreshRecurringForUser(userId, today));
  await runUserStep("cron.sync.net-worth", () => writeNetWorthSnapshot(userId, today));
  await runUserStep("cron.sync.aprs", () => syncCardAprsForUser(userId));
  await runUserStep("cron.sync.notifications", () => processNotificationsForUser(userId, today));
  await runUserStep("cron.sync.digest", () => sendDailyDigest(service, userId));
  await runUserStep("cron.sync.retention", () => pruneOperationalData(service, userId));
  return stepFailures;
}

async function processOneUser(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  hasBank: boolean,
  deadline: number,
  failures: string[],
): Promise<boolean> {
  try {
    const userFailures = await syncUser(service, userId, hasBank, deadline);
    // A user cut short by the deadline keeps its place at the front of the
    // next run instead of being stamped as maintained.
    if (!userFailures.includes("DEADLINE_EXCEEDED")) {
      const { error } = await service.from("profiles")
        .update({ last_maintenance_at: new Date().toISOString() }).eq("id", userId);
      if (error) userFailures.push(`cron.sync.maintenance-stamp: ${safeSyncError(error)}`);
    }
    if (userFailures.length) {
      failures.push(userFailures.join("; "));
      return false;
    }
    return true;
  } catch (error) {
    logError("cron.sync.user", error);
    failures.push(safeSyncError(error));
    return false;
  }
}

async function syncUsers(
  service: ReturnType<typeof createServiceClient>,
  userIds: string[],
  bankUserIds: Set<string>,
  deadline: number,
): Promise<{ synced: number; failures: string[]; skipped: number }> {
  let next = 0;
  let synced = 0;
  const failures: string[] = [];
  async function runNext(): Promise<void> {
    if (next >= userIds.length || Date.now() >= deadline) return;
    const userId = userIds[next++]!;
    if (await processOneUser(service, userId, bankUserIds.has(userId), deadline, failures)) {
      synced += 1;
    }
    return runNext();
  }
  await Promise.all([runNext(), runNext()]);
  const skipped = userIds.length - next;
  if (skipped) failures.push(`DEADLINE_EXCEEDED: ${skipped} users skipped`);
  return { synced, failures, skipped };
}

async function loadBankSyncUsers(service: ReturnType<typeof createServiceClient>): Promise<Set<string>> {
  const { data, error } = await service
    .from("plaid_items")
    .select("user_id")
    .eq("status", "active");
  if (error) throw error;

  const { data: legacyErrors, error: legacyError } = await service
    .from("plaid_items").select("user_id, error_code").eq("status", "error");
  if (legacyError) throw legacyError;
  const bankUserIds = new Set((data ?? []).map((r) => r.user_id as string));
  for (const item of legacyErrors ?? []) {
    if (item.error_code && !requiresPlaidUserAction(item.error_code)) bankUserIds.add(item.user_id as string);
  }
  return bankUserIds;
}

// Data-integrity checks are best-effort so maintenance results still report.
async function reportIntegrityFindings(
  service: ReturnType<typeof createServiceClient>,
  userIds: string[],
  deadline: number,
): Promise<void> {
  try {
    const integrityFindings: string[] = [];
    for (const userId of userIds) {
      if (Date.now() >= deadline) break;
      const [{ data: jobs }, txns, { data: accts }] = await Promise.all([
        service
          .from("sync_jobs")
          .select("status, updated_at")
          .eq("user_id", userId)
          .eq("status", "running"),
        loadUserTransactions(service, userId),
        service.from("accounts").select("id").eq("user_id", userId),
      ]);
      const findings = runIntegrityChecks({
        nowMs: Date.now(),
        syncJobs: (jobs ?? []).map((j) => ({
          status: j.status as string,
          updatedAt: j.updated_at as string,
        })),
        transactions: txns,
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
}

/**
 * Daily maintenance for all users, with bank sync for active connections.
 * Protected by CRON_SECRET: Vercel Cron sends "Authorization: Bearer <secret>"
 * when the CRON_SECRET env var is set.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const deadline = Date.now() + (maxDuration - 45) * 1000;
  try {
    const service = createServiceClient();
    const bankUserIds = await loadBankSyncUsers(service);
    const userIds = await loadMaintenanceUsers(service, bankUserIds);
    const { synced, failures, skipped } = await syncUsers(service, userIds, bankUserIds, deadline);

    await reportIntegrityFindings(service, userIds, deadline);

    // Global counters contain no owner data; expired windows need no tombstones.
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const { error: countersError } = await service.from("rate_limit_counters")
      .delete().lt("window_start", twoDaysAgo);
    if (countersError) logError("cron.sync.prune.counters", countersError);

    if (failures.length > 0) {
      await alertCronFailure("daily-sync", {
        failed: failures.length,
        total: userIds.length,
        firstError: failures[0],
      });
      // 207, not 200 with ok:true (A-10): a partial sync must not read as
      // success to the scheduler. Per-user detail rides in `failures`.
      return NextResponse.json(
        { ok: false, users: userIds.length, synced, failures, skipped },
        { status: 207 },
      );
    }

    return NextResponse.json({ ok: true, users: userIds.length, synced, skipped });
  } catch (error) {
    await alertCronFailure("daily-sync", {
      failed: 1,
      total: 1,
      firstError: safeSyncError(error),
    });
    return errorResponse("cron.sync", error);
  }
}
