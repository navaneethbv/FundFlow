import Image from "next/image";
import Badge from "@/components/ui/Badge";
import ProgressBar, { type ProgressBarTone } from "@/components/ui/ProgressBar";
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

// Monarch tints both On track and Completed green (a lighter tint for
// On track) — Badge only has one green tone, so both map to "success"; the
// label text (not just color) is what actually distinguishes them.
const BADGE_COPY: Record<GoalBadge, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  completed: { label: "Completed", tone: "success" },
  "on-track": { label: "On track", tone: "success" },
  "at-risk": { label: "At risk", tone: "warning" },
  behind: { label: "Behind", tone: "danger" },
  "no-pace": { label: "No pace data", tone: "neutral" },
};

const BAR_TONE: Record<GoalBadge, ProgressBarTone> = {
  completed: "success",
  "on-track": "accent",
  "at-risk": "warning",
  behind: "danger",
  "no-pace": "neutral",
};

export default function GoalCard({
  goal,
  currency,
  action,
  menu,
  priorityImage = false,
}: Readonly<{
  goal: FundedGoal;
  currency: string;
  /** Slot for the client-side "Allocate funds" control. */
  action?: React.ReactNode;
  /** Slot for the card's `⋯` menu (edit/contribute/household/delete). */
  menu?: React.ReactNode;
  /** Eagerly load only the first above-the-fold goal illustration. */
  priorityImage?: boolean;
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
          priority={priorityImage}
          className="h-32 w-full object-cover"
        />
      ) : (
        // A goal with no template (every pay-down goal, for one) still needs a
        // card head, so the accent wash stands in for the illustration.
        <div aria-hidden className="h-32 w-full bg-accent-soft" />
      )}

      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-base font-semibold">{goal.name}</h2>
          <span className="flex items-center gap-1">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            {menu}
          </span>
        </div>

        <p className="mt-3 text-2xl font-semibold tabular-nums">
          {formatCurrency(goal.funded_amount, currency)}
          <span className="text-sm font-normal text-muted">
            {" "}
            of {formatCurrency(target, currency)}
          </span>
        </p>

        <ProgressBar
          className="mt-3"
          percent={goal.progressPct}
          tone={BAR_TONE[goal.badge]}
          label={`${goal.progressPct}% funded`}
        />

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
