import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildBackupArchive } from "@/lib/backup";
import {
  collectReceiptAssets,
  collectUserData,
  countUserDataRows,
  countUserRecordRows,
  RECEIPT_ASSETS_KEY,
  RECEIPT_ASSETS_OMITTED_KEY,
} from "@/lib/user-data";
import { sendBackupEmail } from "@/lib/reporting";
import { alertCronFailure } from "@/lib/cron-alert";
import { errorResponse, requireCronAuth } from "@/lib/http";
import { logError } from "@/lib/log";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * How long a claim may sit undelivered before another run may take it over.
 * Comfortably longer than `maxDuration`, so an in-flight send is never stolen.
 */
const STALE_CLAIM_MS = 30 * 60 * 1000;

class BackupDeliveryUncertainError extends Error {
  constructor() {
    super("Backup delivery may have reached the recipient. Reconcile the delivery journal before retrying.");
    this.name = "BackupDeliveryUncertainError";
  }
}

/** Persist the send boundary before contacting SMTP, which has no idempotency key. */
async function startBackupSend(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  period: string,
): Promise<void> {
  const { data, error } = await service
    .from("backup_deliveries")
    .update({ send_started_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("period", period)
    .is("send_started_at", null)
    .is("delivered_at", null)
    .select("user_id");
  if (error) throw error;
  if (!data?.length) throw new BackupDeliveryUncertainError();
}

/**
 * Monthly encrypted backup (2.1): per user, serialize the full takeout
 * payload, gzip + AES-256-GCM encrypt with BACKUP_ENC_KEY, and email it to
 * the user's signup address. Fails closed without the key. Service client
 * throughout (cron context), and every query in lib/user-data.ts scopes
 * user_id explicitly — RLS is not a backstop under the service client, so a
 * missing filter would cross-feed one user's data into another's backup.
 */
async function backupSingleUser(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  today: string,
  backupKey: string,
): Promise<boolean> {
  const sections = await collectUserData(service, userId, { includeRestoreKeys: true });
  if (countUserRecordRows(sections) === 0) {
    return false;
  }

  // Receipt images ride along with their metadata rows so a restore returns the
  // pictures too; whatever the budget leaves behind is named in the archive.
  const receiptAssets = await collectReceiptAssets(service, sections.receipts ?? []);

  const archive = buildBackupArchive(
    {
      backup_version: 2,
      exported_at: today,
      ...sections,
      [RECEIPT_ASSETS_KEY]: receiptAssets.assets,
      [RECEIPT_ASSETS_OMITTED_KEY]: receiptAssets.omitted,
    },
    backupKey,
    userId,
  );

  const { data: userData, error: userError } = await service.auth.admin.getUserById(userId);
  if (userError) throw userError;
  const email = userData?.user?.email;
  if (!email) return false;

  await startBackupSend(service, userId, today.slice(0, 7));
  try {
    await sendBackupEmail(email, `fundflow-backup-${today}.json.enc`, archive, today);
    const { data, error } = await service
      .from("backup_deliveries")
      .update({ delivered_at: new Date().toISOString(), rows_backed_up: countUserDataRows(sections) })
      .eq("user_id", userId)
      .eq("period", today.slice(0, 7))
      .select("user_id");
    if (error) throw error;
    if (!data?.length) throw new Error("Backup completion row is missing");
  } catch (error) {
    logError("cron.backup.delivery_uncertain", error);
    // Neither an SMTP rejection nor a failed completion write proves that the
    // recipient did not receive the email. Keep the durable send boundary.
    throw new BackupDeliveryUncertainError();
  }

  await writeAudit({
    userId,
    action: "data_backup",
    metadata: {
      rows: countUserDataRows(sections),
      date: today,
      receipt_assets: receiptAssets.assets.length,
      receipt_assets_omitted: receiptAssets.omitted.length,
    },
  });
  return true;
}

interface BackupBatchResult {
  sent: number;
  skipped: number;
  failures: { userId: string; error: string }[];
}

type ClaimOutcome = "claimed" | "already_delivered" | "claimed_elsewhere";

/**
 * Atomically claim this user's backup for the period, or report who holds it.
 *
 * The insert is the claim: `backup_deliveries` is keyed on (user_id, period),
 * so exactly one caller can create the row and a concurrent invocation gets
 * nothing back from `ignoreDuplicates`. Every error is checked and rethrown,
 * which is the point of the table -- the previous dedup read audit_logs rows
 * written by writeAudit(), which swallows both the returned error and any
 * exception, so a delivered backup could lose its marker and be resent.
 *
 * Only a stale claim that never crossed the send boundary can be reclaimed.
 * Once SMTP may have accepted the email, recovery requires reconciliation.
 */
async function claimBackupDelivery(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  period: string,
): Promise<ClaimOutcome> {
  const { data: inserted, error: insertError } = await service
    .from("backup_deliveries")
    .upsert({ user_id: userId, period }, { onConflict: "user_id,period", ignoreDuplicates: true })
    .select("user_id");
  if (insertError) throw insertError;
  if ((inserted ?? []).length > 0) return "claimed";

  const { data: existing, error: readError } = await service
    .from("backup_deliveries")
    .select("delivered_at, claimed_at, send_started_at")
    .eq("user_id", userId)
    .eq("period", period)
    .maybeSingle();
  if (readError) throw readError;
  if (existing?.delivered_at) return "already_delivered";
  if (existing?.send_started_at) throw new BackupDeliveryUncertainError();

  const claimedAt = Date.parse(String(existing?.claimed_at ?? ""));
  const isStale =
    Number.isFinite(claimedAt) && Date.now() - claimedAt > STALE_CLAIM_MS;
  if (!isStale) return "claimed_elsewhere";

  const { data: reclaimed, error: reclaimError } = await service
    .from("backup_deliveries")
    .update({ claimed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("period", period)
    .is("delivered_at", null)
    .is("send_started_at", null)
    .lt("claimed_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString())
    .select("user_id");
  if (reclaimError) throw reclaimError;
  return (reclaimed ?? []).length > 0 ? "claimed" : "claimed_elsewhere";
}

/**
 * Release a claim whose send failed, so the next run retries instead of the
 * user silently missing a month.
 */
async function releaseBackupClaim(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  period: string,
): Promise<void> {
  const { error } = await service
    .from("backup_deliveries")
    .delete()
    .eq("user_id", userId)
    .eq("period", period)
    .is("delivered_at", null)
    .is("send_started_at", null);
  if (error) logError("cron.backup.release_claim", error);
}

async function fetchAllProfileIds(
  service: ReturnType<typeof createServiceClient>,
): Promise<Array<{ id: string }>> {
  const profiles: Array<{ id: string }> = [];
  const PAGE_SIZE = 1000;
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const query = service.from("profiles").select("id").order("id", { ascending: true });
    const res = await query.range(from, to);
    if (res?.error) throw res.error;
    const rows = (res?.data ?? []) as Array<{ id: string }>;
    profiles.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return profiles;
}

async function processUserBackups(
  service: ReturnType<typeof createServiceClient>,
  profiles: Array<{ id: string }>,
  today: string,
  backupKey: string,
): Promise<BackupBatchResult> {
  const period = today.slice(0, 7);
  let sent = 0;
  let skipped = 0;
  const failures: { userId: string; error: string }[] = [];

  for (const profile of profiles) {
    const userId = profile.id;
    let claimed = false;
    try {
      const outcome = await claimBackupDelivery(service, userId, period);
      if (outcome !== "claimed") {
        skipped += 1;
        continue;
      }
      claimed = true;
      const wasSent = await backupSingleUser(service, userId, today, backupKey);
      if (wasSent) {
        sent += 1;
      } else {
        // Nothing worth archiving, or no address to send to. Drop the claim so
        // a later run reconsiders once the account has data.
        await releaseBackupClaim(service, userId, period);
      }
    } catch (err) {
      logError("cron.backup.user", err);
      if (claimed && !(err instanceof BackupDeliveryUncertainError)) {
        await releaseBackupClaim(service, userId, period);
      }
      failures.push({
        userId,
        error: err instanceof Error ? err.name : "unknown_error",
      });
    }
  }

  return { sent, skipped, failures };
}

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const backupKey = serverEnv.backupEncKey;
  if (!backupKey) {
    await alertCronFailure("backup", {
      failed: 1,
      total: 1,
      firstError: "BACKUP_ENC_KEY is not configured; backups are OFF",
    });
    return NextResponse.json(
      { ok: false, error: "BACKUP_ENC_KEY not configured" },
      { status: 500 },
    );
  }

  try {
    const service = createServiceClient();
    const profiles = await fetchAllProfileIds(service);

    const today = new Date().toISOString().slice(0, 10);
    const totalUsers = profiles.length;
    const { sent, skipped, failures } = await processUserBackups(
      service,
      profiles,
      today,
      backupKey,
    );

    if (failures.length > 0) {
      await alertCronFailure("backup", {
        failed: failures.length,
        total: totalUsers,
        firstError: failures[0].error,
      });
      return NextResponse.json(
        {
          ok: false,
          users: totalUsers,
          sent,
          skipped,
          failed: failures.length,
          failures,
        },
        { status: sent > 0 ? 207 : 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      users: totalUsers,
      sent,
      skipped,
    });
  } catch (error) {
    await alertCronFailure("backup", { failed: 1, total: 1, firstError: "run_crashed" });
    return errorResponse("cron.backup", error);
  }
}
