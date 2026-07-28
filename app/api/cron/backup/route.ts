import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { safeEqual } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { buildBackupArchive } from "@/lib/backup";
import { sendBackupEmail } from "@/lib/reporting";
import { alertCronFailure } from "@/lib/cron-alert";
import { errorResponse } from "@/lib/http";
import { logError } from "@/lib/log";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Monthly encrypted backup (2.1): per user, serialize the full takeout
 * payload, gzip + AES-256-GCM encrypt with BACKUP_ENC_KEY, and email it to
 * the user's signup address. Fails closed without the key. Service client
 * throughout (cron context) — every query scopes user_id explicitly.
 */
export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv.cronSecret}`;
  if (!safeEqual(header, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
        const [
          { data: accounts },
          { data: transactions },
          { data: budgets },
          { data: goals },
          { data: rules },
          { data: manualAccounts },
        ] = await Promise.all([
          service
            .from("accounts")
            .select("name, official_name, mask, type, subtype, current_balance, available_balance, credit_limit, iso_currency_code")
            .eq("user_id", userId),
          service
            .from("transactions")
            .select("date, amount, iso_currency_code, name, merchant_name, pfc_primary, pfc_detailed, pending")
            .eq("user_id", userId),
          service.from("budgets").select("category, monthly_limit, rollover_enabled").eq("user_id", userId),
          service.from("goals").select("name, target_amount, saved_amount, target_date").eq("user_id", userId),
          service.from("merchant_rules").select("match_type, pattern, display_name, category, enabled").eq("user_id", userId),
          service.from("manual_accounts").select("name, account_type, balance, include_in_net_worth").eq("user_id", userId),
        ]);

        if ((transactions ?? []).length === 0) continue; // nothing to protect yet

        const archive = buildBackupArchive(
          {
            backup_version: 1,
            exported_at: today,
            accounts: accounts ?? [],
            transactions: transactions ?? [],
            budgets: budgets ?? [],
            goals: goals ?? [],
            merchant_rules: rules ?? [],
            manual_accounts: manualAccounts ?? [],
          },
          backupKey,
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
          metadata: { rows: (transactions ?? []).length, date: today },
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
