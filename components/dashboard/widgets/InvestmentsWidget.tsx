import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import DropdownButton from "@/components/ui/DropdownButton";
import { formatCurrency } from "@/lib/format";
import type { DashboardInvestmentSummary } from "@/lib/dashboard-widgets-data";

/** Investments summary with real latest-day movement and top movers. */
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
      {summary && summary.total > 0 && summary.hasHoldings === false && (
        <p className="mt-1.5 text-xs text-muted">
          Itemized holdings are unavailable from your provider; tracking total account balance.
        </p>
      )}
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
            Top movers
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            {summary.topMovers.map((mover) => (
              <li key={mover.id} className="flex justify-between gap-3">
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
