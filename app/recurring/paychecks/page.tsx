import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import ButtonLink from "@/components/ui/ButtonLink";
import PaycheckPlan from "@/components/recurring/PaycheckPlan";
import { requireUser } from "@/lib/http";
import { resolveViewerToday } from "@/lib/report-period";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { loadPaycheckPlan } from "@/lib/paycheck-planner-data";
export const metadata = { title: "Paycheck planner" };
export const dynamic = "force-dynamic";
export default async function PaychecksPage() {
  if (!isFeatureEnabled("paycheckPlanner")) notFound();
  const auth = await requireUser();
  if (auth instanceof NextResponse) redirect("/login");
  const today = await resolveViewerToday(auth.supabase, auth.user.id);
  const plan = await loadPaycheckPlan(auth.supabase, auth.user.id, today);
  if (!plan) notFound();
  let content = (
    <p>Confirm a payday and take-home amount before planning pay periods.</p>
  );
  if (plan.configured) {
    content = plan.currencyUnsupported ? (
      <p>
        This planner currently supports USD accounts only. Mixed currencies are
        not combined or converted.
      </p>
    ) : (
      <PaycheckPlan periods={plan.periods} cash={plan.cash} />
    );
  }
  return (
    <AppShell active="recurring" email={auth.user.email}>
      <PageHeader
        title="Paycheck planner"
        actions={
          <>
            <ButtonLink href="/recurring">Recurring bills</ButtonLink>
            {isFeatureEnabled("paydaySettings") && (
              <ButtonLink href="/settings/payday">Confirm payday</ButtonLink>
            )}
          </>
        }
      />
      {content}
    </AppShell>
  );
}
