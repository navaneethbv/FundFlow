import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { MAX_STEP_UP_ATTEMPTS_PER_HOUR, verifyStepUp } from "@/lib/step-up";
import { readBackupEnvelope } from "@/lib/backup";
import { serverEnv } from "@/lib/env.server";
import {
  buildRestorePlan,
  executeRestore,
  RestoreValidationError,
} from "@/lib/restore";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";
import type { User } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/feature-flags";

/**
 * The backup restore path (features.md #5): upload the encrypted archive the
 * monthly backup cron emailed, preview what it would change (dry run), then
 * confirm a per-table, all-or-nothing restore — behind the same step-up
 * re-authentication and rate-limit discipline as account deletion.
 *
 * The archive must be user-bound: envelopes without the per-user KDF binding
 * (legacy raw-key archives) or bound to a different user are rejected before
 * any data work. `readBackupEnvelope`'s GCM auth tag rejects a tampered
 * archive outright.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  if (!isFeatureEnabled("backupRestore")) {
    return NextResponse.json(
      { error: "Backup restore is temporarily disabled." },
      { status: 403 },
    );
  }

  const allowed = await checkRateLimit(`backup-restore:${user.id}`, MAX_STEP_UP_ATTEMPTS_PER_HOUR, 3600);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a while." },
      { status: 429 },
    );
  }

  try {
    if (!serverEnv.backupEncKey) {
      return NextResponse.json(
        { error: "Backups are not configured on this deployment." },
        { status: 400 },
      );
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const dryRun = form?.get("dry_run") === "true";
    const code = form?.get("code");
    if (!(file instanceof File)) return badRequest("A backup archive file is required.");

    // Step-up before anything touches the user's data — even the dry run, so
    // a stolen session cannot probe whether an archive decrypts.
    if (typeof code !== "string" || code.length === 0) {
      return badRequest("A verification code is required.");
    }
    const stepUpOk = await verifyStepUp(supabase, user as unknown as User, code);
    if (!stepUpOk) {
      await writeAudit({
        userId: user.id,
        action: "data_restore_failed",
        metadata: { reason: "step_up_failed" },
        ip: getClientIp(request),
      });
      return NextResponse.json({ error: "Verification failed. Try again." }, { status: 401 });
    }

    let payload: unknown;
    let boundUserId: string | null;
    try {
      const archive = Buffer.from(await file.arrayBuffer());
      ({ payload, userId: boundUserId } = readBackupEnvelope(archive, serverEnv.backupEncKey));
    } catch {
      return badRequest("This file is not a readable FundFlow backup archive.");
    }
    if (boundUserId !== user.id) {
      // Covers legacy raw-key archives (no binding) and other users' archives.
      return badRequest("This archive is not bound to your account.");
    }

    let plan;
    try {
      plan = buildRestorePlan(payload);
    } catch (error) {
      if (error instanceof RestoreValidationError) return badRequest(error.message);
      throw error;
    }

    if (dryRun) {
      await writeAudit({
        userId: user.id,
        action: "data_restore_dry_run",
        metadata: {
          total_rows: plan.totalRows,
          tables: plan.tables.length,
          unknown_keys: plan.unknownKeys,
        },
        ip: getClientIp(request),
      });
      return NextResponse.json({ dryRun: true, plan });
    }

    await writeAudit({
      userId: user.id,
      action: "data_restore",
      metadata: { total_rows: plan.totalRows, tables: plan.tables.length, phase: "attempt" },
      ip: getClientIp(request),
    });

    const service = createServiceClient();
    const result = await executeRestore(
      service,
      user.id,
      plan,
      payload as Record<string, unknown[]>,
    );

    await writeAudit({
      userId: user.id,
      action: "data_restore",
      metadata: {
        phase: "result",
        rows_written: result.tables.reduce((sum, table) => sum + table.rowsWritten, 0),
        failed_table: result.failedTable,
        regenerated_ids: result.regeneratedIds,
        skipped: result.skipped,
      },
      ip: getClientIp(request),
    });

    return NextResponse.json({ dryRun: false, result });
  } catch (error) {
    return errorResponse("backup.restore", error);
  }
}
