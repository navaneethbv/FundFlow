import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import DropdownButton from "@/components/ui/DropdownButton";
import ProgressBar, { type ProgressBarTone } from "@/components/ui/ProgressBar";
import { formatCurrency } from "@/lib/format";
import type { BudgetEnvelope } from "@/lib/planning";

/** The envelopes closest to trouble first — a widget has room for a few. */
const VISIBLE = 4;

const STATUS_TONE: Record<string, ProgressBarTone> = {
  over: "danger",
  "at-risk": "warning",
  "on-track": "success",
};

export default function BudgetWidget({
  envelopes,
  currency,
  error = null,
}: Readonly<{
  envelopes: BudgetEnvelope[];
  currency: string;
  error?: string | null;
}>) {
  const ranked = [...envelopes]
    .sort((a, b) => {
      const rank = (status: string) =>
        status === "over" ? 0 : status === "at-risk" ? 1 : 2;
      return rank(a.status) - rank(b.status) || b.spent - a.spent;
    })
    .slice(0, VISIBLE);
  const totalSpent = envelopes.reduce((sum, envelope) => sum + envelope.spent, 0);

  return (
    <WidgetShell
      title="Budget"
      value={ranked.length > 0 ? `${formatCurrency(totalSpent, currency)} spent` : undefined}
      error={error}
      empty={
        ranked.length === 0
          ? "No budgets set. Add one to track planned against actual."
          : null
      }
      action={<DropdownButton label="This month" items={[{ label: "Open Budget", href: "/budget" }]} />}
    >
      <ul className="space-y-3">
        {ranked.map((envelope) => {
          const pct =
            envelope.monthlyLimit > 0
              ? Math.min(100, Math.round((envelope.spent / envelope.monthlyLimit) * 100))
              : 0;
          return (
            <li key={envelope.category}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate">{envelope.category}</span>
                <span className="tabular-nums text-muted">
                  {formatCurrency(envelope.spent, currency)} /{" "}
                  {formatCurrency(envelope.monthlyLimit, currency)}
                </span>
              </div>
              <ProgressBar
                className="mt-1"
                size="sm"
                percent={pct}
                tone={STATUS_TONE[envelope.status] ?? "accent"}
                label={`${envelope.category}: ${pct}% of budget used, ${envelope.status}`}
              />
            </li>
          );
        })}
      </ul>
    </WidgetShell>
  );
}
