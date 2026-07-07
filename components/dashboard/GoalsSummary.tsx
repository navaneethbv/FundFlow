import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import { goalProgressPct, type Goal } from "@/lib/goals";

/** Read-only overview of the top savings goals; full CRUD lives on /goals. */
export default function GoalsSummary({ goals }: { goals: Goal[] }) {
  if (goals.length === 0) {
    return (
      <p className="py-4 text-sm text-muted">
        No savings goals yet.{" "}
        <Link href="/goals" className="font-semibold text-accent hover:underline">
          Create one
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {goals.slice(0, 3).map((goal) => {
        const pct = goalProgressPct(goal.saved_amount, goal.target_amount);
        const complete = pct >= 100;
        return (
          <div key={goal.id}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-semibold">{goal.name}</span>
              <span className="shrink-0 text-xs font-bold tabular-nums text-muted">
                {formatCurrency(goal.saved_amount)} / {formatCurrency(goal.target_amount)}
              </span>
            </div>
            <span className="block h-2 rounded-full bg-panel-hover">
              <span
                className="block h-2 rounded-full"
                style={{
                  width: `${pct}%`,
                  backgroundColor: complete ? "var(--viz-good)" : "var(--accent)",
                }}
              />
            </span>
          </div>
        );
      })}
      <Link
        href="/goals"
        className="inline-block text-xs font-semibold text-accent hover:underline"
      >
        View all goals
      </Link>
    </div>
  );
}
