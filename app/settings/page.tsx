import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
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
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link href="/dashboard" className="underline text-sm">
          Back to dashboard
        </Link>
      </header>

      <MfaSection />
      <BanksSection initialItems={items ?? []} />
      <BudgetsSection initialBudgets={budgets ?? []} />
      <ExportSection initialEnabled={profile?.ai_export_enabled ?? true} />
      <ImportSection accounts={accounts ?? []} />
      <ReportsSection initialEnabled={profile?.weekly_report_enabled ?? true} />
      <DangerZone />
    </main>
  );
}
