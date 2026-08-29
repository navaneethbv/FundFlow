import Link from "next/link";
import ProgressBar from "@/components/ui/ProgressBar";
import { formatCurrency } from "@/lib/format";
import type { GoalSummaryItem } from "@/lib/goal-summary";

/** Read-only overview of the top savings goals; full CRUD lives on /goals. */
export default function GoalsSummary({
  goals,
}: Readonly<{ goals: GoalSummaryItem[] }>) {
  if (goals.length === 0) {
    return (
      <p className="py-4 text-sm text-muted">
        No savings goals yet.{" "}
        <Link
          href="/goals"
          className="font-semibold text-accent hover:underline"
        >
          Create one
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {goals.slice(0, 3).map((goalSummary) => {
        const item = goalSummary;
        const paceSuffix = item.monthlyPace
          ? `, ${formatCurrency(item.monthlyPace)} needed monthly`
          : "";
        return (
          <div key={item.id}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-semibold">
                {item.name}
              </span>
              <span className="shrink-0 text-xs font-bold tabular-nums text-muted">
                {formatCurrency(item.fundedAmount)} /{" "}
                {formatCurrency(item.targetAmount)}
              </span>
            </div>
            <ProgressBar
              percent={item.progressPct}
              tone={item.complete ? "success" : "accent"}
              label={`${item.name}: ${Math.round(Math.min(100, item.progressPct))}% saved`}
            />
            <p className="mt-1 text-xs text-muted">
              {item.complete
                ? "Goal complete"
                : `${formatCurrency(item.remainingAmount)} remaining${paceSuffix}`}
            </p>
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
