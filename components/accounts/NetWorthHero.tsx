import Panel from "@/components/ui/Panel";
import { linePath } from "@/lib/chart-utils";
import { formatCurrency } from "@/lib/format";
import type { AccountsPageData, CurrencyTotal } from "@/lib/accounts-page";

type Summary = AccountsPageData["summary"];

function totalFor(totals: CurrencyTotal[], currency: string): number {
  return totals.find((entry) => entry.currency === currency)?.amount ?? 0;
}

function HistoryChart({ summary }: Readonly<{ summary: Summary }>) {
  const W = 720;
  const H = 130;
  const PAD = 20;
  const allPoints = Object.values(summary.netWorthSeries).flat();
  if (allPoints.length < 2) {
    return (
      <p className="py-3 text-sm text-muted">
        More daily snapshots are needed before a trend can be drawn.
      </p>
    );
  }
  const allValues = allPoints.map((point) => point.value);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const firstDate = allPoints[0]?.date;
  const lastDate = allPoints[allPoints.length - 1]?.date;

  return (
    <div className="space-y-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-h-36"
        role="img"
        aria-label="Daily net worth by currency"
      >
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="var(--viz-grid)" />
        {Object.entries(summary.netWorthSeries).map(([currency, series], seriesIndex) => {
          const points = series.map((point, index) => ({
            x:
              PAD +
              (series.length === 1
                ? (W - PAD * 2) / 2
                : (index / (series.length - 1)) * (W - PAD * 2)),
            y: PAD + (1 - (point.value - min) / range) * (H - PAD * 2),
          }));
          return (
            <path
              key={currency}
              d={linePath(points)}
              fill="none"
              stroke={`var(--viz-${(seriesIndex % 6) + 1})`}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>{currency}</title>
            </path>
          );
        })}
      </svg>
      {firstDate && lastDate && (
        <div className="flex justify-between px-1 text-xs text-muted font-mono">
          <span>{firstDate}</span>
          <span>{lastDate}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The headline net-worth figure + trend chart, promoted out of the
 * "Balance sheet" card into its own hero above the fold — Monarch's own
 * Accounts page leads with this number, not with a card grid. Picks the
 * first currency as the primary headline; multi-currency users still get
 * every currency's own figure in the "Balance sheet" panel below (this
 * hero never combines currencies, honoring the same invariant that panel
 * already enforces).
 */
export default function NetWorthHero({
  summary,
  historyStartsOn,
}: Readonly<{
  summary: Summary;
  historyStartsOn: string | null;
}>) {
  const primaryCurrency = summary.currencies[0];
  if (!primaryCurrency) return null;

  const netWorth = totalFor(summary.netWorth, primaryCurrency);
  const monthChange = summary.netWorthMonthChange[primaryCurrency];

  return (
    <Panel eyebrow="Net worth">
      <p data-money className="metric-value text-4xl">
        {formatCurrency(netWorth, primaryCurrency)}
      </p>
      {monthChange && (
        <p className="mt-1.5 text-sm font-semibold">
          <span
            data-money
            className={monthChange.amount >= 0 ? "text-[var(--viz-pos)]" : "text-[var(--viz-neg)]"}
          >
            {monthChange.amount >= 0 ? "↑" : "↓"}{" "}
            {formatCurrency(Math.abs(monthChange.amount), primaryCurrency)}
          </span>{" "}
          <span className="text-muted">1 month change</span>
        </p>
      )}
      <div className="mt-5">
        <HistoryChart summary={summary} />
      </div>
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2">
          View daily balance table
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-panel-border text-muted font-mono">
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Currency</th>
                <th className="px-2 py-2 text-right font-semibold">Net worth</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.netWorthSeries).flatMap(([currency, series]) =>
                series.map((point) => (
                  <tr key={`${currency}-${point.date}`} className="border-b border-panel-border/70">
                    <td className="px-2 py-2 font-mono">{point.date}</td>
                    <td className="px-2 py-2 font-mono">{currency}</td>
                    <td data-money className="px-2 py-2 text-right tabular-nums">
                      {formatCurrency(point.value, currency)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
      {historyStartsOn && (
        <p className="mt-4 text-xs text-muted">
          Daily balance history starts on {historyStartsOn}. Earlier history is
          unavailable.
        </p>
      )}
    </Panel>
  );
}
