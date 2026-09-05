import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildBackupArchive } from "@/lib/backup";
import {
  collectUserData,
  countUserDataRows,
  countUserRecordRows,
} from "@/lib/user-data";
import { sendBackupEmail } from "@/lib/reporting";
import { alertCronFailure } from "@/lib/cron-alert";
import { errorResponse, requireCronAuth } from "@/lib/http";
import { logError } from "@/lib/log";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const archive = buildBackupArchive(
    {
      backup_version: 1,
      exported_at: today,
      ...sections,
    },
    backupKey,
    userId,
  );

  const { data: userData } = await service.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (!email) return false;

  await sendBackupEmail(
    email,
    `fundflow-backup-${today}.json.enc`,
    archive,
    today,
  );
  await writeAudit({
    userId,
    action: "data_backup",
    metadata: {
      rows: countUserDataRows(sections),
      date: today,
    },
  });
  return true;
}

interface BackupBatchResult {
  sent: number;
  skipped: number;
  failures: { userId: string; error: string }[];
}

async function fetchAllAuditUserIds(
  service: ReturnType<typeof createServiceClient>,
  action: string,
  sinceIso: string,
): Promise<Set<string>> {
  const userIds = new Set<string>();
  const PAGE_SIZE = 1000;
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const query = service
      .from("audit_logs")
      .select("user_id")
      .eq("action", action)
      .gte("created_at", sinceIso)
      .order("id", { ascending: true });
    const res = await query.range(from, to);
    const rows = (res?.data ?? []) as Array<{ user_id?: string | null }>;
    for (const r of rows) {
      if (r?.user_id) userIds.add(r.user_id);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return userIds;
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
  const monthPrefix = today.slice(0, 7);
  let sent = 0;
  let skipped = 0;
  const failures: { userId: string; error: string }[] = [];

  const alreadySentUsers = await fetchAllAuditUserIds(
    service,
    "data_backup",
    `${monthPrefix}-01T00:00:00Z`,
  );

  for (const profile of profiles) {
    const userId = profile.id;
    if (alreadySentUsers.has(userId)) {
      skipped += 1;
      continue;
    }

    try {
      const wasSent = await backupSingleUser(service, userId, today, backupKey);
      if (wasSent) sent += 1;
    } catch (err) {
      logError("cron.backup.user", err);
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
