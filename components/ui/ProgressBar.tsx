import { cn } from "@/lib/cn";

export type ProgressBarTone = "accent" | "success" | "warning" | "danger" | "neutral";

const TONE_CLASSES: Record<ProgressBarTone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-muted",
};

/**
 * Thin rounded progress track, replacing the four ad-hoc bar recipes this
 * app had (BudgetWidget, GoalCard, GoalsSummary, MonthSummary each drew
 * their own). A `label` makes it a described image (a goal's "62% funded"
 * summary, where the number is the point); omitting it makes it a real
 * `progressbar` with a numeric value (a month's "how much of this budget is
 * spent" meter, where the fraction itself is the point) — pick whichever
 * matches what the bar is actually reporting.
 */
export default function ProgressBar({
  percent,
  tone = "accent",
  size = "md",
  label,
  ariaLabel,
  className,
}: Readonly<{
  /** 0-100; clamped to that range. */
  percent: number;
  tone?: ProgressBarTone;
  size?: "sm" | "md";
  /** Provide for a described-image bar; omit for a numeric progressbar. */
  label?: string;
  /** Numeric-progressbar variant only: names *which* bar, e.g. "Income progress". */
  ariaLabel?: string;
  className?: string;
}>) {
  const clamped = Math.max(0, Math.min(100, percent));
  const a11yProps = label
    ? { role: "img" as const, "aria-label": label }
    : {
        role: "progressbar" as const,
        "aria-valuenow": Math.round(clamped),
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      };

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-full bg-panel-2",
        size === "sm" ? "h-1.5" : "h-2",
        className,
      )}
      {...a11yProps}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", TONE_CLASSES[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
