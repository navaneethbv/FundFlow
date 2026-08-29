import GoalsSummary from "@/components/dashboard/GoalsSummary";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import DropdownButton from "@/components/ui/DropdownButton";
import type { GoalSummaryItem } from "@/lib/goal-summary";

export default function GoalsWidget({
  goals,
  error = null,
}: Readonly<{ goals: GoalSummaryItem[]; error?: string | null }>) {
  return (
    <WidgetShell
      title="Goals"
      error={error}
      action={
        <DropdownButton
          label="All goals"
          items={[{ label: "Open Goals", href: "/goals" }]}
        />
      }
    >
      {/* GoalsSummary carries its own empty state with a create link. */}
      <GoalsSummary goals={goals.slice(0, 3)} />
    </WidgetShell>
  );
}
