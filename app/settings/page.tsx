import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import MfaSection from "@/components/settings/MfaSection";
import ExportSection from "@/components/settings/ExportSection";
import ReportsSection from "@/components/settings/ReportsSection";
import ImportSection from "@/components/settings/ImportSection";
import BudgetsSection from "@/components/settings/BudgetsSection";
import BanksSection from "@/components/settings/BanksSection";
import DangerZone from "@/components/settings/DangerZone";
import ManualAccountsSection from "@/components/settings/ManualAccountsSection";
import MerchantRulesSection from "@/components/settings/MerchantRulesSection";
import NotificationsSection from "@/components/settings/NotificationsSection";
import PlanningPreferencesSection from "@/components/settings/PlanningPreferencesSection";
import AuditLogSection from "@/components/settings/AuditLogSection";
import SessionsSection from "@/components/settings/SessionsSection";
import PasskeysSection from "@/components/settings/PasskeysSection";
import HouseholdSection from "@/components/settings/HouseholdSection";
import { buildAuditLogPage, buildSessionList } from "@/lib/security-account";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: profile },
    { data: items },
    { data: budgets },
    { data: accounts },
    { data: merchantRules },
    { data: manualAccounts },
    { data: notifications },
    { data: alertPreferences },
    { data: aiSettings },
    { data: auditLogs },
    { data: sessionRows },
    { data: households },
  ] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("ai_export_enabled, weekly_report_enabled")
        .eq("id", user?.id ?? "")
        .single(),
      supabase
        .from("plaid_items")
        .select("id, institution_name, status, error_code")
        .order("created_at"),
      supabase
        .from("budgets")
        .select("id, category, monthly_limit")
        .order("category"),
      supabase.from("accounts").select("id, name, mask").order("name"),
      supabase
        .from("merchant_rules")
        .select("id, match_type, pattern, display_name, category, enabled")
        .order("created_at"),
      supabase
        .from("manual_accounts")
        .select("id, name, account_type, balance, include_in_net_worth")
        .order("created_at"),
      supabase
        .from("notifications")
        .select("id, type, severity, title, body, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("alert_preferences")
        .select("broken_bank, budget_exceeded, goal_reached, large_transaction, low_cash_forecast")
        .eq("user_id", user?.id ?? "")
        .maybeSingle(),
      supabase
        .from("ai_settings")
        .select("enabled")
        .eq("user_id", user?.id ?? "")
        .maybeSingle(),
      supabase
        .from("audit_logs")
        .select("user_id, action, metadata")
        .eq("user_id", user?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("user_session_records")
        .select("id, user_agent, last_seen_at")
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(5),
      supabase
        .from("households")
        .select("id, name")
        .order("created_at", { ascending: false }),
    ]);

  const auditPage = buildAuditLogPage(
    (auditLogs ?? []).map((row) => ({
      userId: row.user_id as string | null,
      action: row.action as string,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    })),
    user?.id ?? "",
    5,
  );
  const sessions = buildSessionList(
    (sessionRows ?? []).map((row) => ({
      id: row.id as string,
      current: false,
      userAgent: row.user_agent as string | null,
      lastSeenAt: row.last_seen_at as string,
    })),
  );

  return (
    <AppShell active="settings" email={user?.email}>
      <div className="space-y-6">
        <header>
          <p className="eyebrow">Control center</p>
          <h1 className="display mt-2 text-3xl sm:text-4xl">Settings</h1>
        </header>

        <div className="grid gap-6 xl:grid-cols-3">
          <BanksSection initialItems={items ?? []} />
          <div id="budgets">
            <BudgetsSection initialBudgets={budgets ?? []} />
          </div>
          <MfaSection />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <ImportSection accounts={accounts ?? []} />
          <div className="space-y-6">
            <ExportSection initialEnabled={profile?.ai_export_enabled ?? true} />
            <div id="reports">
              <ReportsSection initialEnabled={profile?.weekly_report_enabled ?? true} />
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <div id="cleanup">
            <MerchantRulesSection initialRules={merchantRules ?? []} />
          </div>
          <ManualAccountsSection initialAccounts={manualAccounts ?? []} />
        </div>

        <div id="alerts" className="grid gap-6 xl:grid-cols-2">
          <NotificationsSection initialNotifications={notifications ?? []} />
          <PlanningPreferencesSection
            initialPreferences={alertPreferences}
            initialAiEnabled={aiSettings?.enabled ?? false}
          />
        </div>

        <div id="security" className="grid gap-6 xl:grid-cols-2">
          <PasskeysSection />
          <SessionsSection initialSessions={sessions} />
          <AuditLogSection initialRows={auditPage.rows} />
          <HouseholdSection initialHouseholds={(households ?? []) as Array<{ id: string; name: string }>} />
        </div>

        <DangerZone />
      </div>
    </AppShell>
  );
}
