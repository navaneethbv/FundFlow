import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import DropdownButton from "@/components/ui/DropdownButton";
import { formatCurrency } from "@/lib/format";
import type { DashboardInvestmentSummary } from "@/lib/dashboard-widgets-data";

/**
 * Investments. Phase 9A is what actually supplies holdings; until then this
 * renders the "sync another account" empty state the plan calls for rather
 * than being hidden, so the widget's existence is discoverable and the grid
 * layout does not shift when 9A lands.
 *
 * Monarch's populated header also shows a same-day dollar change ("$43,590
 * investments  $0.00 Today") and a "Top movers today" strip below the total —
 * both need per-holding day-change data this widget doesn't receive today
 * (the dashboard loader only fetches asset-class totals, not
 * `investment-performance.ts`'s day-change figures). Deferred rather than
 * faked with a placeholder "$0.00".
 */
export default function InvestmentsWidget({
  summary = null,
  currency,
  error = null,
}: Readonly<{
  summary?: DashboardInvestmentSummary | null;
  currency: string;
  error?: string | null;
}>) {
  return (
    <WidgetShell
      title="Investments"
      error={error}
      empty={
        !summary || summary.total === 0
          ? "No investment holdings yet. Sync another account to see them here."
          : null
      }
      action={
        <DropdownButton
          label="Holdings"
          items={[{ label: "Open Investments", href: "/investments" }]}
        />
      }
    >
      <p data-money className="metric-value text-2xl sm:text-3xl">
        {formatCurrency(summary?.total ?? 0, currency)}
      </p>
      {summary?.dayChange && (
        <p
          data-money
          className={`mt-1 text-sm font-semibold ${summary.dayChange.amount >= 0 ? "text-success" : "text-danger"}`}
        >
          {summary.dayChange.amount >= 0 ? "+" : ""}
          {formatCurrency(summary.dayChange.amount, currency)} today
          <span className="ml-1 text-muted">
            ({summary.dayChange.pct >= 0 ? "+" : ""}{summary.dayChange.pct.toFixed(1)}%)
          </span>
        </p>
      )}
      {summary?.topMovers && summary.topMovers.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Top movers today
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            {summary.topMovers.map((mover) => (
              <li key={`${mover.name}:${mover.ticker ?? ""}`} className="flex justify-between gap-3">
                <span className="truncate">
                  {mover.name}
                  {mover.ticker && <span className="ml-1 text-muted">{mover.ticker}</span>}
                </span>
                <span
                  className={mover.changePct >= 0 ? "text-success" : "text-danger"}
                >
                  {mover.changePct >= 0 ? "+" : ""}{mover.changePct.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetShell>
  );
}
