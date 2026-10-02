import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import ButtonLink from "@/components/ui/ButtonLink";
import PaydaySettingsForm from "@/components/settings/PaydaySettingsForm";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { requireUser } from "@/lib/http";
import { loadPaydaySettings } from "@/lib/payday-data";
import { getCachedDashboardData } from "@/lib/dashboard-cache";
import { resolveViewerToday } from "@/lib/report-period";
export const metadata = { title: "Payday settings" };
export const dynamic = "force-dynamic";
export default async function PaydayPage() {
  if (!isFeatureEnabled("paydaySettings")) notFound();
  const auth = await requireUser();
  if (auth instanceof NextResponse) redirect("/login");
  const today = await resolveViewerToday(auth.supabase, auth.user.id);
  const [stored, dashboard] = await Promise.all([
    loadPaydaySettings(auth.supabase, auth.user.id),
    getCachedDashboardData(auth.supabase, auth.user.id, undefined, undefined, {
      today,
    }),
  ]);
  return (
    <AppShell active="settings" email={auth.user.email}>
      <PageHeader
        title="Payday settings"
        actions={<ButtonLink href="/recurring">Recurring bills</ButtonLink>}
      />
      <PaydaySettingsForm
        stored={stored}
        suggested={dashboard.insights.paycheck}
        today={today}
      />
    </AppShell>
  );
}
