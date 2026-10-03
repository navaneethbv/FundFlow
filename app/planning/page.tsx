import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import Panel from "@/components/ui/Panel";
import PlanningCalculators from "@/components/planning/PlanningCalculators";
import PrivateLendingPanel from "@/components/planning/PrivateLendingPanel";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { requireUser } from "@/lib/http";
import { loadForecastPageData } from "@/lib/forecasting-data";
import { loadPrivateLendingData } from "@/lib/private-lending-data";
import { resolveViewerToday } from "@/lib/report-period";

export const dynamic = "force-dynamic";
export const metadata = { title: "Planning tools" };

export default async function PlanningPage() {
  const calculatorsEnabled = isFeatureEnabled("planningCalculators");
  const lendingEnabled = isFeatureEnabled("privateLending");
  if (!calculatorsEnabled && !lendingEnabled) notFound();
  const auth = await requireUser();
  if (auth instanceof NextResponse) notFound();
  const today = await resolveViewerToday(auth.supabase, auth.user.id);
  const [forecast, lending] = await Promise.all([
    calculatorsEnabled ? loadForecastPageData(auth.supabase, auth.user.id, today) : Promise.resolve(null),
    lendingEnabled ? loadPrivateLendingData(auth.supabase, auth.user.id, today) : Promise.resolve(null),
  ]);
  return (
    <AppShell active="planning" email={auth.user.email}>
      <PageHeader title="Planning tools" description="Editable scenarios and owner-entered private lending. Each result is a projection based on the assumptions shown." />
      {calculatorsEnabled && forecast && <PlanningCalculators essentialMonthlySpend={forecast.essentialMonthlyExpenses} currentSavings={forecast.startingState.cash} />}
      {lendingEnabled && lending && (
        <section aria-labelledby="private-lending-heading" className="space-y-4">
          <div><h2 id="private-lending-heading" className="card-title">Private lending</h2><p className="mt-1 text-sm text-muted">Track money lent or borrowed between people. Optional interest accrues daily, and payments apply to interest before principal.</p></div>
          <PrivateLendingPanel loans={lending.loans} summary={lending.summary} today={today} />
        </section>
      )}
      {!calculatorsEnabled && <Panel title="Planning calculators are disabled" eyebrow="Release gated"><p className="text-sm text-muted">Enable the planning calculators flag after the disposable acceptance journey passes.</p></Panel>}
    </AppShell>
  );
}
