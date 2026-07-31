import Link from "next/link";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import { formatCurrency } from "@/lib/format";
import type { BudgetEnvelope } from "@/lib/planning";

/** The envelopes closest to trouble first — a widget has room for a few. */
const VISIBLE = 4;

const STATUS_TONE: Record<string, string> = {
  over: "var(--viz-bad)",
  "at-risk": "var(--viz-3)",
  "on-track": "var(--viz-good)",
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

  return (
    <WidgetShell
      title="Budget"
      hint="This month"
      error={error}
      empty={
        ranked.length === 0
          ? "No budgets set. Add one to track planned against actual."
          : null
      }
      action={
        <Link
          href="/budget"
          className="text-sm font-semibold text-accent hover:underline"
        >
          Open
        </Link>
      }
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
              <div
                className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-panel-2"
                role="img"
                aria-label={`${envelope.category}: ${pct}% of budget used, ${envelope.status}`}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: STATUS_TONE[envelope.status] ?? "var(--viz-1)",
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </WidgetShell>
  );
}
