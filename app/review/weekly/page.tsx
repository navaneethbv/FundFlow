import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import WeeklyReviewRitual from "@/components/review/WeeklyReviewRitual";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { requireUser } from "@/lib/http";
import { resolveViewerToday } from "@/lib/report-period";
import { loadWeeklyReviewData } from "@/lib/weekly-review";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly review" };

export default async function WeeklyReviewPage() {
  if (!isFeatureEnabled("weeklyReview")) notFound();
  const auth = await requireUser();
  if (auth instanceof NextResponse) notFound();
  const today = await resolveViewerToday(auth.supabase, auth.user.id);
  const data = await loadWeeklyReviewData(auth.supabase, auth.user.id, today);
  return (
    <AppShell active="reports" email={auth.user.email}>
      <PageHeader title="Weekly review" description="Five focused checks to keep your financial picture current. Review each step, then record the completion for this week." />
      <WeeklyReviewRitual
        steps={data.steps}
        weekStart={data.weekStart}
        initialStreak={data.streak}
        initialCompleted={data.completed}
      />
    </AppShell>
  );
}
