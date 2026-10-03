import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import GoalProgressRing from "@/components/goals/GoalProgressRing";
import GoalProjectionChart from "@/components/goals/GoalProjectionChart";
import Badge from "@/components/ui/Badge";
import PageHeader from "@/components/shell/PageHeader";
import Panel from "@/components/ui/Panel";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { buildGoalProjection } from "@/lib/goal-projection";
import { GOAL_BADGE_LABEL, type GoalBadge } from "@/lib/goals-v2";
import { formatCurrency } from "@/lib/format";
import { loadGoalsPageData } from "@/lib/goals-data";
import { resolveViewerToday } from "@/lib/report-period";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const BADGE_TONE: Record<GoalBadge, "success" | "warning" | "danger" | "neutral"> = {
  completed: "success",
  "on-track": "success",
  "at-risk": "warning",
  behind: "danger",
  "no-pace": "neutral",
};

export const metadata = {
  title: "Goal details",
};

export default async function GoalDetailPage({ params }: Readonly<PageProps>) {
  if (!isFeatureEnabled("goalVisuals")) notFound();

  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const [data, today] = await Promise.all([
    loadGoalsPageData(supabase, user.id),
    resolveViewerToday(supabase, user.id),
  ]);
  const goal = data.goals.find((item) => item.id === id);
  if (!goal) notFound();

  // The server clock is UTC; project from the viewer's own month.
  const projection = buildGoalProjection(goal, today.slice(0, 7));

  return (
    <AppShell active="goals" email={user.email}>
      <PageHeader
        title={goal.name}
        actions={
          <Link
            href="/goals"
            className="inline-flex min-h-11 items-center rounded-field px-3 text-sm font-semibold text-accent hover:bg-panel-hover focus-visible:outline-2"
          >
            Back to goals
          </Link>
        }
      />

      <section className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)]">
        <Panel className="flex flex-col items-center justify-center gap-3 text-center" aria-label="Goal progress">
          <GoalProgressRing percent={goal.progressPct} badge={goal.badge} />
          <Badge tone={BADGE_TONE[goal.badge]}>{GOAL_BADGE_LABEL[goal.badge]}</Badge>
          <p className="text-sm text-muted">{formatCurrency(goal.funded_amount)} of {formatCurrency(goal.funded_amount + goal.remainingAmount)} funded</p>
        </Panel>

        <Panel title="Goal summary">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted">Remaining</dt>
              <dd data-money className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(goal.remainingAmount)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Target date</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{goal.target_date ?? "No deadline"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Needed each month</dt>
              <dd data-money className="mt-1 text-xl font-semibold tabular-nums">{goal.est_monthly === null ? "No pace data" : formatCurrency(goal.est_monthly)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Goal type</dt>
              <dd className="mt-1 text-xl font-semibold">{goal.goal_type === "pay_down" ? "Pay down" : "Save up"}</dd>
            </div>
          </dl>
        </Panel>
      </section>

      <Panel title="Funding projection" className="mt-5">
        {projection ? (
          <GoalProjectionChart points={projection.points} capped={projection.capped} />
        ) : (
          <p className="text-sm text-muted">
            A projection needs an unfinished goal with a target date and a positive monthly pace.
          </p>
        )}
      </Panel>
    </AppShell>
  );
}
