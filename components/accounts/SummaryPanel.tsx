import Link from "next/link";
import Panel from "@/components/ui/Panel";
import { linePath } from "@/lib/chart-utils";
import { formatCurrency } from "@/lib/format";
import type { AccountsPageData, CurrencyTotal } from "@/lib/accounts-page";

type Summary = AccountsPageData["summary"];
type SummaryQuery = {
  scope?: string;
  institution?: string;
  type?: string;
  visibility?: string;
  owner?: string;
  range?: string;
  summary?: string;
};

function totalFor(totals: CurrencyTotal[], currency: string): number {
  return totals.find((entry) => entry.currency === currency)?.amount ?? 0;
}

function formatSignedPercent(pct: number | null): string {
  if (pct === null) return "Not enough history";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct}%`;
}

function HistoryChart({ summary }: Readonly<{ summary: Summary }>) {
  const W = 720;
  const H = 220;
  const PAD = 24;
  const allPoints = Object.values(summary.netWorthSeries).flat();
  if (allPoints.length < 2) {
    return (
      <p className="py-8 text-sm text-muted">
        More daily snapshots are needed before a trend can be drawn.
      </p>
    );
  }
  const allValues = allPoints.map((point) => point.value);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Daily net worth by currency"
    >
      <line
        x1={PAD}
        x2={W - PAD}
        y1={H - PAD}
        y2={H - PAD}
        stroke="var(--viz-grid)"
      />
      {Object.entries(summary.netWorthSeries).map(
        ([currency, series], seriesIndex) => {
          const points = series.map((point, index) => ({
            x:
              PAD +
              (series.length === 1
                ? (W - PAD * 2) / 2
                : (index / (series.length - 1)) * (W - PAD * 2)),
            y:
              PAD +
              (1 - (point.value - min) / range) * (H - PAD * 2),
          }));
          return (
            <path
              key={currency}
              d={linePath(points)}
              fill="none"
              stroke={`var(--viz-${(seriesIndex % 6) + 1})`}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>{currency}</title>
            </path>
          );
        },
      )}
    </svg>
  );
}

export default function SummaryPanel({
  summary,
  historyStartsOn,
  mode,
  query = {},
  filtered = false,
}: Readonly<{
  summary: Summary;
  historyStartsOn: string | null;
  mode: "totals" | "percent";
  query?: SummaryQuery;
  /** A filter is hiding rows below, but this balance sheet stays portfolio-wide. */
  filtered?: boolean;
}>) {
  function summaryHref(nextMode: "totals" | "percent"): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }
    params.set("summary", nextMode);
    return `/accounts?${params.toString()}`;
  }

  return (
    <Panel
      title="Balance sheet"
      eyebrow="Performance"
      action={
        <span className="inline-flex rounded-field border border-panel-border p-1 text-xs font-semibold">
          <Link
            href={summaryHref("totals")}
            aria-current={mode === "totals" ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded px-2 py-1 focus-visible:outline-2"
          >
            Totals
          </Link>
          <Link
            href={summaryHref("percent")}
            aria-current={mode === "percent" ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded px-2 py-1 focus-visible:outline-2"
          >
            Percent
          </Link>
        </span>
      }
    >
      {summary.currencyMismatch && (
        <p className="mb-4 rounded-field bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          Totals are separated by currency because FundFlow does not guess
          exchange rates.
        </p>
      )}

      {filtered && (
        <p className="mb-4 text-sm text-muted">
          This balance sheet covers every account, including any hidden or
          filtered out of the list below.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {summary.currencies.map((currency) => {
          const monthChange = summary.netWorthMonthChange[currency];
          const netWorth = totalFor(summary.netWorth, currency);
          const percentLabel = formatSignedPercent(monthChange?.pct ?? null);
          return (
            <div
              key={currency}
              className="rounded-field border border-panel-border bg-panel-2 p-4"
            >
              <p className="text-xs font-semibold text-muted">{currency}</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums">
                {mode === "percent"
                  ? percentLabel
                  : formatCurrency(netWorth, currency)}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted">Assets</dt>
                  <dd className="mt-1 font-semibold">
                    {formatCurrency(totalFor(summary.assets, currency), currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Liabilities</dt>
                  <dd className="mt-1 font-semibold">
                    {formatCurrency(
                      totalFor(summary.liabilities, currency),
                      currency,
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

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
              <tr className="border-b border-panel-border text-muted">
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Currency</th>
                <th className="px-2 py-2 text-right font-semibold">
                  Net worth
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.netWorthSeries).flatMap(
                ([currency, series]) =>
                  series.map((point) => (
                    <tr
                      key={`${currency}-${point.date}`}
                      className="border-b border-panel-border/70"
                    >
                      <td className="px-2 py-2">{point.date}</td>
                      <td className="px-2 py-2">{currency}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">
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
