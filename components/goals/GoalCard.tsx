"use client";

import { formatCurrency } from "@/lib/format";
import type { FundedGoal } from "@/lib/goals-v2";

export default function GoalCard({ goal }: Readonly<{ goal: FundedGoal }>) {
  const pct = Math.min(100, Math.round((goal.funded_amount / (goal.target_amount || 1)) * 100));

  const badgeStyles = {
    "completed": "bg-emerald-500/10 text-emerald-500",
    "on-track": "bg-accent/10 text-accent",
    "at-risk": "bg-amber-500/10 text-amber-500",
    "behind": "bg-danger/10 text-danger",
  };

  return (
    <div className="rounded-panel border border-panel-border bg-panel p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">{goal.name}</h3>
          <p className="text-xs text-muted">
            Target: {formatCurrency(goal.target_amount)} {goal.target_date ? `· By ${goal.target_date}` : ""}
          </p>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${badgeStyles[goal.badge]}`}>
          {goal.badge}
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">
            {formatCurrency(goal.funded_amount)} funded
          </span>
          <span className="text-muted">{pct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-panel-border overflow-hidden">
          <div className="h-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {goal.est_monthly !== null && (
        <p className="text-xs text-muted">
          Estimated monthly contribution: <strong className="text-foreground">{formatCurrency(goal.est_monthly)}/mo</strong>
        </p>
      )}
    </div>
  );
}
