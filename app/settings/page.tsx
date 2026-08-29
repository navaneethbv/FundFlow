import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import SettingsLayout from "@/components/settings/SettingsLayout";
import ProfileSection from "@/components/settings/ProfileSection";
import DisplaySection from "@/components/settings/DisplaySection";
import TagsSection from "@/components/settings/TagsSection";
import MfaSection from "@/components/settings/MfaSection";
import ExportSection from "@/components/settings/ExportSection";
import ReportsSection from "@/components/settings/ReportsSection";
import ImportSection from "@/components/settings/ImportSection";
import ImportReviewSection from "@/components/settings/ImportReviewSection";
import MonarchConfigImportSection from "@/components/settings/MonarchConfigImportSection";
import AiInsightsSection from "@/components/settings/AiInsightsSection";
import BudgetsSection from "@/components/settings/BudgetsSection";
import BanksSection from "@/components/settings/BanksSection";
import ReconciliationSection from "@/components/settings/ReconciliationSection";
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
import { suggestBudgets } from "@/lib/insights";
import ButtonLink from "@/components/ui/ButtonLink";
import Panel from "@/components/ui/Panel";
import { sectionFromParam, parseDisplayPrefs, type SettingsSection } from "@/components/settings/settings-nav";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { loadInstitutionObservability } from "@/lib/sync-health";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ section?: string | string[] }>;
}

/** First day of the month `offset` months from now, as YYYY-MM-01. */
function monthStart(offset: number): string {
  const now = new Date();
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() + offset;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

type SettingsSupabase = Awaited<ReturnType<typeof createClient>>;

/** Profile section: the stored fields plus a short-lived signed avatar URL. */
async function renderProfileSection(
  supabase: SettingsSupabase,
  userId: string,
): Promise<React.ReactNode> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, display_name, birthday, avatar_path")
    .eq("id", userId)
    .maybeSingle();
  let avatarUrl: string | null = null;
  if (profile?.avatar_path) {
    const { data: signed } = await supabase.storage
      .from("avatars")
      .createSignedUrl(profile.avatar_path as string, 3600);
    avatarUrl = signed?.signedUrl ?? null;
  }
  return (
    <ProfileSection
      fullName={(profile?.full_name as string | null) ?? null}
      displayName={(profile?.display_name as string | null) ?? null}
      birthday={(profile?.birthday as string | null) ?? null}
      avatarUrl={avatarUrl}
    />
  );
}

/**
 * Household preferences: settle-up, which only means anything once the primary
 * household has a second member. Member emails come from the service client
 * (auth.users is not readable through RLS), looked up by id one at a time.
 */
async function renderHouseholdPreferences(
  supabase: SettingsSupabase,
  userId: string,
): Promise<React.ReactNode> {
  const [{ data: households }, { data: householdMembers }, { data: sharedExpenses }] = await Promise.all([
    supabase.from("households").select("id, name").order("created_at", { ascending: false }),
    supabase.from("household_members").select("household_id, user_id, role"),
    supabase
      .from("shared_expenses")
      .select("id, household_id, paid_by, owed_user_id, description, amount, settled_at")
      .order("created_at"),
  ]);
  const primaryHousehold = (households ?? [])[0] as { id: string; name: string } | undefined;
  const memberRows = ((householdMembers ?? []) as Array<{ household_id: string; user_id: string }>).filter(
    (row) => row.household_id === primaryHousehold?.id,
  );
  const memberIds = new Set<string>(memberRows.map((row) => row.user_id));
  if (userId) memberIds.add(userId);

  const settleUpMembers = await loadSettleUpMembers(memberIds, Boolean(primaryHousehold));
  if (!primaryHousehold || settleUpMembers.length <= 1 || !userId) {
    return (
      <Panel title="Settle up" eyebrow="Household">
        <p className="text-sm text-muted">
          Settlement tracking appears once your household has more than one member.
        </p>
      </Panel>
    );
  }
  return (
    <SettleUpSection
      householdId={primaryHousehold.id}
      currentUserId={userId}
      members={settleUpMembers}
      initialExpenses={((sharedExpenses ?? []) as Array<{
        id: string;
        household_id: string;
        paid_by: string;
        owed_user_id: string;
        description: string;
        amount: number;
        settled_at: string | null;
      }>).filter((row) => row.household_id === primaryHousehold.id)}
    />
  );
}

/** Member id -> email for settle-up. Empty unless there is more than one. */
async function loadSettleUpMembers(
  memberIds: ReadonlySet<string>,
  hasHousehold: boolean,
): Promise<Array<{ userId: string; email: string }>> {
  if (!hasHousehold || memberIds.size <= 1) return [];
  const { createServiceClient } = await import("@/lib/supabase/service");
  const service = createServiceClient();
  const members: Array<{ userId: string; email: string }> = [];
  for (const memberId of memberIds) {
    const { data: memberUser } = await service.auth.admin.getUserById(memberId);
    members.push({ userId: memberId, email: memberUser?.user?.email ?? "member" });
  }
  return members;
}

export default async function SettingsPage({ searchParams }: Readonly<PageProps>) {
  const params = await searchParams;
  // Gated: Profile/Display/Tags are the only sections that read the new
  // profile columns or user_tags — everything else uses tables that already
  // existed, so this only needs to redirect three sections, not the page.
  const settingsIaReady = isFeatureEnabled("settingsIa");
  const migrationDependentSections: SettingsSection[] = ["profile", "display", "tags"];
  let active = sectionFromParam(params.section);
  if (!settingsIaReady && migrationDependentSections.includes(active)) {
    active = "institutions";
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? "";

  let content: React.ReactNode;

  switch (active) {
    case "profile": {
      content = await renderProfileSection(supabase, userId);
      break;
    }
    case "display": {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_prefs, dashboard_prefs")
      .eq("id", userId)
      .maybeSingle();
    content = (
      <>
        <DisplaySection initialPrefs={parseDisplayPrefs(profile?.display_prefs)} />
        <DashboardPrefsSection
          initialPrefs={
            ((profile as { dashboard_prefs?: Record<string, boolean> } | null)?.dashboard_prefs ??
              {}) as Record<string, boolean>
          }
        />
      </>
    );
      break;
    }
    case "notifications": {
    content = (
      <>
        <Panel title="Notifications" eyebrow="Alerts and delivery">
          <p className="mb-4 text-sm text-muted">
            Review your feed and manage optional in-app alerts from the notification center.
          </p>
          <ButtonLink href="/notifications">Open notifications</ButtonLink>
        </Panel>
        <ReportsSection />
      </>
    );
      break;
    }
    case "security": {
    const activeSessionId = await currentSessionId(supabase);
    const [{ data: auditLogs }, { data: sessionRows }] = await Promise.all([
      supabase
        .from("audit_logs")
        .select("user_id, action, metadata")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("user_session_records")
        .select("id, session_id, user_agent, last_seen_at")
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(5),
    ]);
    const auditPage = buildAuditLogPage(
      (auditLogs ?? []).map((row) => ({
        userId: row.user_id as string | null,
        action: row.action as string,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
      })),
      userId,
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
    content = (
      <div className="grid gap-6 xl:grid-cols-2">
        <MfaSection />
        <PasskeysSection />
        <SessionsSection initialSessions={sessions} />
        <AuditLogSection initialRows={auditPage.rows} />
      </div>
    );
      break;
    }
    case "integrations": {
    const [{ data: aiSettings }, { data: calendarTokens }, { data: apiTokens }] = await Promise.all([
      supabase.from("ai_settings").select("enabled").eq("user_id", userId).maybeSingle(),
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
    ]);
    content = (
      <div className="grid gap-6 xl:grid-cols-2">
        <CalendarFeedSection initialTokens={calendarTokens ?? []} />
        <ApiTokensSection
          initialTokens={
            (apiTokens ?? []) as Array<{ id: string; name: string; created_at: string; last_used_at: string | null }>
          }
        />
        <AiInsightsSection enabled={aiSettings?.enabled ?? false} />
        <AskAiSection enabled={aiSettings?.enabled ?? false} />
      </div>
    );
      break;
    }
    case "household-general": {
    const { data: households } = await supabase.from("households").select("id, name").order("created_at", { ascending: false });
    content = (
      <HouseholdSection initialHouseholds={(households ?? []) as Array<{ id: string; name: string }>} />
    );
      break;
    }
    case "household-preferences": {
      content = await renderHouseholdPreferences(supabase, userId);
      break;
    }
    case "institutions": {
    const [{ data: items }, { data: manualAccounts }, { data: accounts }, { data: households }] = await Promise.all([
      supabase
        .from("plaid_items")
        .select("id, institution_name, status, error_code, shared_household_id")
        .order("created_at"),
      supabase.from("manual_accounts").select("id, name, account_type, balance, include_in_net_worth").order("created_at"),
      supabase.from("accounts").select("id, name, mask, type, apr").eq("user_id", userId).order("name"),
      supabase.from("households").select("id").order("created_at", { ascending: false }).limit(1),
    ]);
    const safeItems = (items ?? []) as Array<{
      id: string;
      institution_name: string | null;
      status: string;
      error_code: string | null;
      shared_household_id?: string | null;
    }>;
    const observability = await loadInstitutionObservability(supabase, userId, safeItems);
    const healthByItem = Object.fromEntries(
      observability.institutions.map((health) => [health.plaidItemId, health]),
    );
    content = (
      <>
        <div className="grid gap-6 xl:grid-cols-2">
          <BanksSection
            initialItems={safeItems}
            healthByItem={healthByItem}
            householdId={(households ?? [])[0]?.id ?? null}
          />
          <ManualAccountsSection initialAccounts={manualAccounts ?? []} />
        </div>
        <ReconciliationSection rows={observability.reconciliations} />
        <CardAprSection
          initialAccounts={((accounts ?? []) as Array<{
            id: string;
            name: string | null;
            mask: string | null;
            type: string | null;
            apr: number | null;
          }>).filter((account) => account.type === "credit")}
        />
      </>
    );
      break;
    }
    case "categories": {
    const [{ data: budgets }, { data: categoryOverrides }, { data: spendHistoryRows }, { data: sinkingFunds }] =
      await Promise.all([
        supabase.from("budgets").select("id, category, monthly_limit, rollover_enabled, household_id").order("category"),
        supabase.from("category_overrides").select("id, source_category, display_category").order("source_category"),
        supabase.rpc("budget_suggestion_history", {
          p_user_id: userId,
          p_start: monthStart(-4),
          p_end: monthStart(0),
        }),
        supabase
          .from("sinking_funds")
          .select("id, name, target_amount, due_date, cadence, custom_interval_months, cycle_anchor_date")
          .order("due_date"),
      ]);
    const { data: households } = await supabase.from("households").select("id").order("created_at", { ascending: false }).limit(1);
    const historyByMonthCategory = new Map<string, number>();
    // The RPC aggregates by (month, category) in SQL, so the row count is the
    // number of categories across four months — bounded and complete — instead
    // of a raw transaction read that PostgREST could silently truncate.
    for (const row of (spendHistoryRows ?? []) as Array<{ month: string; category: string; amount: number }>) {
      const key = `${row.month}|${row.category}`;
      historyByMonthCategory.set(key, (historyByMonthCategory.get(key) ?? 0) + Number(row.amount));
    }
    const budgetSuggestions = suggestBudgets({
      history: [...historyByMonthCategory.entries()].map(([key, amount]) => {
        const [month, category] = key.split("|");
        return { month: month!, category: category!, amount };
      }),
      existingCategories: (budgets ?? []).map((b) => b.category as string),
    }).slice(0, 5);
    content = (
      <>
        <div className="grid gap-6 xl:grid-cols-2">
          <BudgetsSection
            initialBudgets={budgets ?? []}
            suggestions={budgetSuggestions}
            householdId={(households ?? [])[0]?.id ?? null}
          />
          <CategoryOverridesSection
            initialOverrides={(categoryOverrides ?? []) as Array<{
              id: string;
              source_category: string;
              display_category: string;
            }>}
          />
        </div>
        <SinkingFundsSection
          initialFunds={(sinkingFunds ?? []) as Array<{
            id: string;
            name: string;
            target_amount: number;
            due_date: string;
            cadence: "one_time" | "annual" | "semiannual" | "quarterly" | "custom";
            custom_interval_months: number | null;
            cycle_anchor_date: string;
          }>}
        />
        <MonarchConfigImportSection />
      </>
    );
      break;
    }
    case "merchants": {
    const { data: cancelledSubs } = await supabase.from("cancelled_subscriptions").select("merchant").order("merchant");
    content = (
      <CancelledSubscriptionsSection
        initialMerchants={((cancelledSubs ?? []) as Array<{ merchant: string }>).map((row) => row.merchant)}
      />
    );
      break;
    }
    case "rules": {
    const { data: merchantRules } = await supabase
      .from("merchant_rules")
      .select("id, match_type, pattern, display_name, category, enabled")
      .order("created_at");
    content = <MerchantRulesSection initialRules={merchantRules ?? []} />;
      break;
    }
    case "tags": {
    const { data: tagRows } = await supabase.from("user_tags").select("id, name").eq("user_id", userId).order("name");
    content = <TagsSection initialTags={(tagRows ?? []) as Array<{ id: string; name: string }>} />;
      break;
    }
    default: {
    // data
    const [{ data: profile }, { data: accounts }, { data: manualAccounts }, { data: aiSettings }, { data: items }] = await Promise.all([
      supabase.from("profiles").select("ai_export_enabled").eq("id", userId).maybeSingle(),
      supabase.from("accounts").select("id, name, mask, type, apr").eq("user_id", userId).order("name"),
      supabase.from("manual_accounts").select("id, name, account_type").eq("user_id", userId).order("name"),
      supabase.from("ai_settings").select("enabled").eq("user_id", userId).maybeSingle(),
      supabase.from("plaid_items").select("id").eq("user_id", userId).limit(1),
    ]);
    const importAccounts = [
      ...(accounts ?? []).map((account) => ({ ...account, kind: "account" as const })),
      ...(manualAccounts ?? []).map((account) => ({
        id: account.id,
        name: account.name,
        mask: null,
        kind: "manual" as const,
      })),
    ];
    content = (
      <>
        <div className="grid gap-6 xl:grid-cols-2">
          <ExportSection initialEnabled={profile?.ai_export_enabled ?? true} />
          <ImportSection accounts={importAccounts} />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <ImportReviewSection accounts={importAccounts} />
          <ReceiptScanSection enabled={aiSettings?.enabled ?? false} />
        </div>
        <DemoDataSection hasBanks={(items ?? []).length > 0} />
        <DangerZone />
      </>
    );
      break;
    }
  }

  return (
    <AppShell active="settings" email={user?.email}>
      <div className="space-y-6">
        <PageHeader title="Settings" />
        <SettingsLayout
          active={active}
          hiddenSections={settingsIaReady ? [] : migrationDependentSections}
        >
          {content}
        </SettingsLayout>
      </div>
    </AppShell>
  );
}
