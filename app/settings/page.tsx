import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import MfaSection from "@/components/settings/MfaSection";
import ExportSection from "@/components/settings/ExportSection";
import ReportsSection from "@/components/settings/ReportsSection";
import ImportSection from "@/components/settings/ImportSection";
import ImportReviewSection from "@/components/settings/ImportReviewSection";
import AiInsightsSection from "@/components/settings/AiInsightsSection";
import BudgetsSection from "@/components/settings/BudgetsSection";
import BanksSection from "@/components/settings/BanksSection";
import DangerZone from "@/components/settings/DangerZone";
import ManualAccountsSection from "@/components/settings/ManualAccountsSection";
import MerchantRulesSection from "@/components/settings/MerchantRulesSection";
import AuditLogSection from "@/components/settings/AuditLogSection";
import SessionsSection from "@/components/settings/SessionsSection";
import PasskeysSection from "@/components/settings/PasskeysSection";
import HouseholdSection from "@/components/settings/HouseholdSection";
import CategoryOverridesSection from "@/components/settings/CategoryOverridesSection";
import CalendarFeedSection from "@/components/settings/CalendarFeedSection";
import CardAprSection from "@/components/settings/CardAprSection";
import ApiTokensSection from "@/components/settings/ApiTokensSection";
import SinkingFundsSection from "@/components/settings/SinkingFundsSection";
import AskAiSection from "@/components/settings/AskAiSection";
import ReceiptScanSection from "@/components/settings/ReceiptScanSection";
import SettleUpSection from "@/components/settings/SettleUpSection";
import CancelledSubscriptionsSection from "@/components/settings/CancelledSubscriptionsSection";
import DashboardPrefsSection from "@/components/settings/DashboardPrefsSection";
import DemoDataSection from "@/components/settings/DemoDataSection";
import { buildAuditLogPage, buildSessionList } from "@/lib/security-account";
import { currentSessionId } from "@/lib/http";
import { EXCLUDED_PFC } from "@/lib/dashboard";
import { suggestBudgets } from "@/lib/insights";
import ButtonLink from "@/components/ui/ButtonLink";
import Panel from "@/components/ui/Panel";

export const dynamic = "force-dynamic";

/** First day of the month `offset` months from now, as YYYY-MM-01. */
function monthStart(offset: number): string {
  const now = new Date();
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() + offset;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const activeSessionId = await currentSessionId(supabase);

  const [
    { data: profile },
    { data: items },
    { data: budgets },
    { data: accounts },
    { data: merchantRules },
    { data: manualAccounts },
    { data: aiSettings },
    { data: auditLogs },
    { data: sessionRows },
    { data: households },
    { data: spendHistoryRows },
    { data: categoryOverrides },
    { data: calendarTokens },
    { data: apiTokens },
    { data: sinkingFunds },
    { data: householdMembers },
    { data: sharedExpenses },
    { data: cancelledSubs },
  ] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("ai_export_enabled, dashboard_prefs")
        .eq("id", user?.id ?? "")
        .single(),
      supabase
        .from("plaid_items")
        .select("id, institution_name, status, error_code, shared_household_id")
        .order("created_at"),
      supabase
        .from("budgets")
        .select("id, category, monthly_limit, rollover_enabled, household_id")
        .order("category"),
      supabase.from("accounts").select("id, name, mask, type, apr").order("name"),
      supabase
        .from("merchant_rules")
        .select("id, match_type, pattern, display_name, category, enabled")
        .order("created_at"),
      supabase
        .from("manual_accounts")
        .select("id, name, account_type, balance, include_in_net_worth")
        .order("created_at"),
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
        .select("id, session_id, user_agent, last_seen_at")
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(5),
      supabase
        .from("households")
        .select("id, name")
        .order("created_at", { ascending: false }),
      supabase
        .from("transactions")
        .select("date, amount, pfc_primary")
        .gte("date", monthStart(-4))
        .lt("date", monthStart(0)),
      supabase
        .from("category_overrides")
        .select("id, source_category, display_category")
        .order("source_category"),
      supabase
        .from("calendar_tokens")
        .select("id, include_amounts, created_at, revoked_at")
        .is("revoked_at", null)
        .order("created_at"),
      supabase
        .from("api_tokens")
        .select("id, name, created_at, last_used_at")
        .is("revoked_at", null)
        .order("created_at"),
      supabase
        .from("sinking_funds")
        .select("id, name, target_amount, due_date")
        .order("due_date"),
      supabase
        .from("household_members")
        .select("household_id, user_id, role"),
      supabase
        .from("shared_expenses")
        .select("id, household_id, paid_by, owed_user_id, description, amount, settled_at")
        .order("created_at"),
      supabase.from("cancelled_subscriptions").select("merchant").order("merchant"),
    ]);

  // Settle-up context: the first household the user owns or belongs to,
  // with member emails resolved server-side (auth.users isn't client-readable).
  const primaryHousehold = (households ?? [])[0] as { id: string; name: string } | undefined;
  const memberRows = ((householdMembers ?? []) as Array<{
    household_id: string;
    user_id: string;
  }>).filter((row) => row.household_id === primaryHousehold?.id);
  const memberIds = new Set<string>(memberRows.map((row) => row.user_id));
  if (user?.id) memberIds.add(user.id);
  const settleUpMembers: Array<{ userId: string; email: string }> = [];
  if (primaryHousehold && memberIds.size > 1) {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const service = createServiceClient();
    for (const memberId of memberIds) {
      const { data: memberUser } = await service.auth.admin.getUserById(memberId);
      settleUpMembers.push({
        userId: memberId,
        email: memberUser?.user?.email ?? "member",
      });
    }
  }

  // Budget suggestions from the last four complete months of spending
  // (RLS-scoped read; transfers/loan payments excluded like every spend total).
  const historyByMonthCategory = new Map<string, number>();
  for (const row of (spendHistoryRows ?? []) as Array<{
    date: string;
    amount: number;
    pfc_primary: string | null;
  }>) {
    const amount = Number(row.amount);
    if (amount <= 0 || EXCLUDED_PFC.has(row.pfc_primary ?? "")) continue;
    const key = `${row.date.slice(0, 7)}|${row.pfc_primary ?? "UNCATEGORIZED"}`;
    historyByMonthCategory.set(key, (historyByMonthCategory.get(key) ?? 0) + amount);
  }
  const budgetSuggestions = suggestBudgets({
    history: [...historyByMonthCategory.entries()].map(([key, amount]) => {
      const [month, category] = key.split("|");
      return { month: month!, category: category!, amount };
    }),
    existingCategories: (budgets ?? []).map((b) => b.category as string),
  }).slice(0, 5);

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
      current: (row.session_id as string) === activeSessionId,
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
          <BanksSection
            initialItems={items ?? []}
            hasHousehold={Boolean(primaryHousehold)}
          />
          <div id="budgets">
            <BudgetsSection
              initialBudgets={budgets ?? []}
              suggestions={budgetSuggestions}
              householdId={primaryHousehold?.id ?? null}
            />
          </div>
          <MfaSection />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <ImportSection accounts={accounts ?? []} />
          <div className="space-y-6">
            <ExportSection initialEnabled={profile?.ai_export_enabled ?? true} />
            <div id="reports">
              <ReportsSection />
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <ImportReviewSection accounts={accounts ?? []} />
          <AiInsightsSection enabled={aiSettings?.enabled ?? false} />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <AskAiSection enabled={aiSettings?.enabled ?? false} />
          <ReceiptScanSection enabled={aiSettings?.enabled ?? false} />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <div id="cleanup">
            <MerchantRulesSection initialRules={merchantRules ?? []} />
          </div>
          <ManualAccountsSection initialAccounts={manualAccounts ?? []} />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <CategoryOverridesSection
            initialOverrides={
              (categoryOverrides ?? []) as Array<{
                id: string;
                source_category: string;
                display_category: string;
              }>
            }
          />
          <CalendarFeedSection initialTokens={calendarTokens ?? []} />
        </div>

        <CardAprSection
          initialAccounts={
            ((accounts ?? []) as Array<{
              id: string;
              name: string | null;
              mask: string | null;
              type: string | null;
              apr: number | null;
            }>).filter((account) => account.type === "credit")
          }
        />

        <div className="grid gap-6 xl:grid-cols-2">
          <SinkingFundsSection
            initialFunds={
              (sinkingFunds ?? []) as Array<{
                id: string;
                name: string;
                target_amount: number;
                due_date: string;
              }>
            }
          />
          <CancelledSubscriptionsSection
            initialMerchants={((cancelledSubs ?? []) as Array<{ merchant: string }>).map(
              (row) => row.merchant,
            )}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <ApiTokensSection
            initialTokens={
              (apiTokens ?? []) as Array<{
                id: string;
                name: string;
                created_at: string;
                last_used_at: string | null;
              }>
            }
          />
          <div className="space-y-6">
            <DashboardPrefsSection
              initialPrefs={
                ((profile as { dashboard_prefs?: Record<string, boolean> } | null)
                  ?.dashboard_prefs ?? {}) as Record<string, boolean>
              }
            />
            <DemoDataSection hasBanks={(items ?? []).length > 0} />
          </div>
        </div>

        <div id="alerts">
          <Panel title="Notifications" eyebrow="Alerts and delivery">
            <p className="mb-4 text-sm text-muted">Review your feed and manage optional in-app alerts from the notification center.</p>
            <ButtonLink href="/notifications">Open notifications</ButtonLink>
          </Panel>
        </div>

        <div id="security" className="grid gap-6 xl:grid-cols-2">
          <PasskeysSection />
          <SessionsSection initialSessions={sessions} />
          <AuditLogSection initialRows={auditPage.rows} />
          <HouseholdSection initialHouseholds={(households ?? []) as Array<{ id: string; name: string }>} />
          {primaryHousehold && settleUpMembers.length > 1 && user?.id && (
            <SettleUpSection
              householdId={primaryHousehold.id}
              currentUserId={user.id}
              members={settleUpMembers}
              initialExpenses={
                ((sharedExpenses ?? []) as Array<{
                  id: string;
                  household_id: string;
                  paid_by: string;
                  owed_user_id: string;
                  description: string;
                  amount: number;
                  settled_at: string | null;
                }>).filter((row) => row.household_id === primaryHousehold.id)
              }
            />
          )}
        </div>

        <DangerZone />
      </div>
    </AppShell>
  );
}
