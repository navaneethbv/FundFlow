import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import MfaSection from "@/components/settings/MfaSection";
import ExportSection from "@/components/settings/ExportSection";
import ReportsSection from "@/components/settings/ReportsSection";
import ImportSection from "@/components/settings/ImportSection";
import BudgetsSection from "@/components/settings/BudgetsSection";
import BanksSection from "@/components/settings/BanksSection";
import DangerZone from "@/components/settings/DangerZone";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: items }, { data: budgets }, { data: accounts }] =
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
    ]);

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

        <DangerZone />
      </div>
    </AppShell>
  );
}
