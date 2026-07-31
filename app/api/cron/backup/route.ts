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
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Monthly encrypted backup (2.1): per user, serialize the full takeout
 * payload, gzip + AES-256-GCM encrypt with BACKUP_ENC_KEY, and email it to
 * the user's signup address. Fails closed without the key. Service client
 * throughout (cron context), and every query scopes user_id explicitly.
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
    // Gated: before 20260730210000_investments.sql is applied, these tables
    // don't exist, and querying them unconditionally would fail every user's
    // backup, not just investors'.
    const investmentsEnabled = isFeatureEnabled("investmentsPage");

    for (const profile of profiles ?? []) {
      const userId = profile.id as string;
      try {
        const results = await Promise.all([
        // ADDING A USER-OWNED TABLE? Add it here too if losing it would cost
        // the user data they cannot re-sync from Plaid (their own budgets,
        // goals, rules, manual records, annotations). Derived or re-syncable
        // data stays out to keep archives small. Every query below MUST keep
        // its explicit .eq("user_id", userId): this runs under the service
        // client, so RLS is not a backstop and a missing filter cross-feeds
        // one user's data into another's backup.
        // Sibling checklists: app/api/export/takeout/route.ts (takeout),
        // the on-delete-cascade FK (deletion), scripts/check-rls.sql (RLS).
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
          service
            .from("account_balance_snapshots")
            .select("account_id, manual_account_id, snapshot_date, current_balance, available_balance, iso_currency_code")
            .eq("user_id", userId),
          service
            .from("budget_periods")
            .select("budget_id, month, planned")
            .eq("user_id", userId),
          service
            .from("saved_reports")
            .select("name, report_type, filters")
            .eq("user_id", userId),
          investmentsEnabled
            ? service
                .from("holdings")
                .select("account_id, manual_account_id, quantity, cost_basis, institution_price, institution_value, as_of, source, is_active")
                .eq("user_id", userId)
            : Promise.resolve({ data: [], error: null }),
          investmentsEnabled
            ? service
                .from("holding_snapshots")
                .select("holding_id, snapshot_date, quantity, price, value")
                .eq("user_id", userId)
            : Promise.resolve({ data: [], error: null }),
          investmentsEnabled
            // Manual securities only — Plaid-sourced ones (user_id null) are
            // shared reference data, not this user's own record to protect.
            ? service
                .from("securities")
                .select("name, ticker, security_type, security_subtype")
                .eq("user_id", userId)
            : Promise.resolve({ data: [], error: null }),
          investmentsEnabled
            ? service
                .from("investment_transactions")
                .select("date, name, amount, quantity, price, fees, txn_type, txn_subtype")
                .eq("user_id", userId)
            : Promise.resolve({ data: [], error: null }),
        ]);
        const failed = results.find((result) => result.error);
        if (failed?.error) throw failed.error;
        const [
          accounts,
          transactions,
          budgets,
          goals,
          rules,
          manualAccounts,
          accountBalanceSnapshots,
          budgetPeriods,
          savedReports,
          holdings,
          holdingSnapshots,
          securities,
          investmentTransactions,
        ] = results.map((result) => result.data);

        const protectedSections = [
          accounts,
          transactions,
          budgets,
          goals,
          rules,
          manualAccounts,
          accountBalanceSnapshots,
          budgetPeriods,
          savedReports,
          holdings,
          holdingSnapshots,
          securities,
          investmentTransactions,
        ];
        if (!protectedSections.some((rows) => (rows ?? []).length > 0)) {
          continue;
        }

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
            account_balance_snapshots: accountBalanceSnapshots ?? [],
            budget_periods: budgetPeriods ?? [],
            saved_reports: savedReports ?? [],
            holdings: holdings ?? [],
            holding_snapshots: holdingSnapshots ?? [],
            securities: securities ?? [],
            investment_transactions: investmentTransactions ?? [],
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
          metadata: {
            rows: protectedSections.reduce(
              (total, rows) => total + (rows ?? []).length,
              0,
            ),
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
