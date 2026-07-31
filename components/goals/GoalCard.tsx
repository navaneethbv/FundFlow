import Image from "next/image";
import Badge from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/format";
import { goalImageAlt, goalImageFor } from "@/lib/goal-templates";
import type { FundedGoal, GoalBadge } from "@/lib/goals-v2";

/**
 * A goal as an image card: illustration, progress bar, badge, and where the
 * funding actually comes from.
 *
 * The badge never relies on colour alone — it carries its own word — and the
 * progress bar is mirrored by a visible percentage, so nothing here depends on
 * being able to distinguish green from amber.
 */

const BADGE_COPY: Record<GoalBadge, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  completed: { label: "Completed", tone: "success" },
  "on-track": { label: "On track", tone: "neutral" },
  "at-risk": { label: "At risk", tone: "warning" },
  behind: { label: "Behind", tone: "danger" },
};

const BAR_TONE: Record<GoalBadge, string> = {
  completed: "var(--viz-good)",
  "on-track": "var(--viz-1)",
  "at-risk": "var(--viz-3)",
  behind: "var(--viz-bad)",
};

export default function GoalCard({
  goal,
  currency,
  action,
}: Readonly<{
  goal: FundedGoal;
  currency: string;
  /** Slot for the client-side "Allocate funds" control. */
  action?: React.ReactNode;
}>) {
  const image = goalImageFor(goal.image_slug);
  const badge = BADGE_COPY[goal.badge];
  const target = goal.funded_amount + goal.remainingAmount;

  return (
    <article className="overflow-hidden rounded-card border border-panel-border bg-panel shadow-card">
      {image ? (
        <Image
          src={image}
          alt={goalImageAlt(goal.image_slug)}
          width={320}
          height={200}
          className="h-32 w-full object-cover"
        />
      ) : (
        // A goal with no template (every pay-down goal, for one) still needs a
        // card head, so the accent wash stands in for the illustration.
        <div aria-hidden className="h-32 w-full bg-accent-soft" />
      )}

      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-base font-semibold">{goal.name}</h3>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>

        <p className="mt-3 text-2xl font-semibold tabular-nums">
          {formatCurrency(goal.funded_amount, currency)}
          <span className="text-sm font-normal text-muted">
            {" "}
            of {formatCurrency(target, currency)}
          </span>
        </p>

        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-panel-2"
          role="img"
          aria-label={`${goal.progressPct}% funded`}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${goal.progressPct}%`,
              background: BAR_TONE[goal.badge],
            }}
          />
        </div>

        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Remaining</dt>
            <dd className="tabular-nums">
              {formatCurrency(goal.remainingAmount, currency)}
            </dd>
          </div>
          {goal.target_date && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Target date</dt>
              <dd className="tabular-nums">{goal.target_date}</dd>
            </div>
          )}
          {goal.est_monthly !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Needed each month</dt>
              <dd className="tabular-nums">
                {formatCurrency(goal.est_monthly, currency)}
              </dd>
            </div>
          )}
          {goal.monthly_contribution !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Planned each month</dt>
              <dd className="tabular-nums">
                {formatCurrency(goal.monthly_contribution, currency)}
              </dd>
            </div>
          )}
          {/* The linked balance is the whole point of an allocation, so the card
              shows it rather than only the derived funded figure. */}
          {goal.linkedAccountBalance !== 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">
                {goal.goal_type === "pay_down"
                  ? "Balance remaining"
                  : "Linked account balance"}
              </dt>
              <dd className="tabular-nums">
                {formatCurrency(goal.linkedAccountBalance, currency)}
              </dd>
            </div>
          )}
        </dl>

        {action && <div className="mt-4">{action}</div>}
      </div>
    </article>
  );
}
