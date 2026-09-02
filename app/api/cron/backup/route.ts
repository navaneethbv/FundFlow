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
    const { data: profiles, error } = await service.from("profiles").select("id");
    if (error) throw error;

    const today = new Date().toISOString().slice(0, 10);
    let sent = 0;
    const failures: string[] = [];

    for (const profile of profiles ?? []) {
      const userId = profile.id as string;
      try {
        // ADDING A USER-OWNED TABLE? Add it once in lib/user-data.ts — the
        // takeout route and this backup both read from that list, so neither
        // can silently drop the user's own budgets, goals, rules, manual
        // records, or annotations. The shared_expenses or() filter keeps one
        // member's backup from carrying the whole household's expenses.
        const sections = await collectUserData(service, userId, { includeRestoreKeys: true });
        // Preference rows alone don't earn a monthly archive email: an account
        // that only ever toggled a notification setting has nothing to restore.
        if (countUserRecordRows(sections) === 0) {
          continue;
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
        if (!email) continue;

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
        sent += 1;
      } catch (err) {
        logError("cron.backup.user", err);
        failures.push(err instanceof Error ? err.name : "unknown_error");
      }
    }

    if (failures.length > 0) {
      await alertCronFailure("backup", {
        failed: failures.length,
        total: (profiles ?? []).length,
        firstError: failures[0],
      });
    }

    return NextResponse.json({ ok: true, users: (profiles ?? []).length, sent });
  } catch (error) {
    await alertCronFailure("backup", { failed: 1, total: 1, firstError: "run_crashed" });
    return errorResponse("cron.backup", error);
  }
}
