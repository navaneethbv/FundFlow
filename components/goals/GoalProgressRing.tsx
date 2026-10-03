import type { GoalBadge } from "@/lib/goals-v2";

function ringColour(badge: GoalBadge): string {
  switch (badge) {
    case "completed":
      return "var(--success)";
    case "on-track":
      return "var(--accent)";
    case "at-risk":
      return "var(--warning)";
    case "behind":
      return "var(--danger)";
    case "no-pace":
      return "var(--muted)";
  }
}

export default function GoalProgressRing({
  percent,
  badge,
}: Readonly<{ percent: number; badge: GoalBadge }>) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;

  return (
    <svg
      viewBox="0 0 120 120"
      className="h-32 w-32 shrink-0"
      role="img"
      aria-label={`${Math.round(clamped)}% funded`}
    >
      <circle
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        stroke="var(--panel-hover)"
        strokeWidth="10"
      />
      <circle
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        stroke={ringColour(badge)}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeLinecap="round"
        strokeWidth="10"
        transform="rotate(-90 60 60)"
      />
      <text
        x="60"
        y="65"
        textAnchor="middle"
        className="money"
        fill="var(--viz-ink)"
        fontSize="22"
        fontWeight="700"
      >
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}
