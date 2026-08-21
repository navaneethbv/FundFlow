import type { ForecastMilestone } from "@/lib/forecasting";
import { formatCurrency } from "@/lib/format";

const BADGE_COLOR_MAP: Record<string, string> = {
  fire: "bg-amber-500/10 text-amber-500",
  debt: "bg-rose-500/10 text-rose-500",
  emergency: "bg-emerald-500/10 text-emerald-500",
};

function getBadgeColor(type: string): string {
  return BADGE_COLOR_MAP[type] ?? "bg-accent-strong/10 text-accent-strong";
}

function getMilestoneCardClass(isReachedNow: boolean, isReachedFuture: boolean): string {
  if (isReachedNow) {
    return "border-accent-strong/40 bg-accent-strong/5";
  }
  if (isReachedFuture) {
    return "border-panel-border bg-panel";
  }
  return "border-panel-border/60 bg-panel/50 opacity-80";
}

export default function MilestonesPanel({
  milestones,
  horizonMonths,
}: Readonly<{
  milestones: ForecastMilestone[];
  horizonMonths: number;
}>) {
  if (milestones.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Projected Milestones & Horizon
        </h2>
        <span className="text-xs text-muted">
          Based on {horizonMonths}-month base scenario
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {milestones.map((m) => {
          const isReachedNow = m.reachedMonth === 0;
          const isReachedFuture = m.reachedMonth !== null && m.reachedMonth > 0;
          const isNotReachedInHorizon = m.reachedMonth === null;

          return (
            <div
              key={m.id}
              className={`flex flex-col justify-between rounded-field border p-4 transition-colors ${getMilestoneCardClass(isReachedNow, isReachedFuture)}`}
            >
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${getBadgeColor(m.type)}`}
                  >
                    {m.type}
                  </span>
                  {isReachedNow && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-500">
                      ✓ Achieved
                    </span>
                  )}
                  {isReachedFuture && (
                    <span className="text-xs font-semibold text-foreground">
                      In ~{m.reachedMonth} mo
                    </span>
                  )}
                  {isNotReachedInHorizon && (
                    <span className="text-xs text-muted">
                      &gt; {horizonMonths} mo
                    </span>
                  )}
                </div>

                <h3 className="font-semibold text-foreground">{m.name}</h3>
                <p className="mt-1 text-xs text-muted">{m.description}</p>
              </div>

              <div className="mt-3 pt-3 border-t border-panel-border/40 flex items-center justify-between text-xs">
                <span className="text-muted">Target</span>
                <span className="money font-semibold text-foreground">
                  {m.targetAmount > 0 ? formatCurrency(m.targetAmount) : "$0 (Paid Off)"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
