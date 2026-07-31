import Link from "next/link";
import GoalsSummary from "@/components/dashboard/GoalsSummary";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import type { Goal } from "@/lib/goals";

/**
 * Deliberately built on the plain `Goal` list rather than Phase 7's
 * `FundedGoal`: funded goals are behind the `goalsV2` flag, and a dashboard
 * widget that renders only when a flag is on is worse than one that always
 * shows the target and manual progress. It picks up funding automatically when
 * the Goals page loader becomes the shared source.
 */
export default function GoalsWidget({
  goals,
  error = null,
}: Readonly<{ goals: Goal[]; error?: string | null }>) {
  return (
    <WidgetShell
      title="Goals"
      hint="Progress"
      error={error}
      action={
        <Link
          href="/goals"
          className="text-sm font-semibold text-accent hover:underline"
        >
          Open
        </Link>
      }
    >
      {/* GoalsSummary carries its own empty state with a create link. */}
      <GoalsSummary goals={goals.slice(0, 3)} />
    </WidgetShell>
  );
}
