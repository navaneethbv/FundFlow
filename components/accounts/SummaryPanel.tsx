import Link from "next/link";
import Panel from "@/components/ui/Panel";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { formatCurrency } from "@/lib/format";
import type { AccountGroupKey, AccountsPageData, CurrencyTotal, GroupAmount } from "@/lib/accounts-page";

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

/**
 * Negative liability balances are credits in the user's favor, so credit and
 * loan groups may appear on the asset side of the balance sheet.
 */
const ASSET_GROUP_COLOR: Partial<Record<AccountGroupKey, string>> = {
  cash: "var(--viz-1)",
  investment: "var(--viz-2)",
  other: "var(--viz-3)",
  credit: "var(--viz-4)",
  loan: "var(--viz-5)",
};

function totalFor(totals: CurrencyTotal[], currency: string): number {
  return totals.find((entry) => entry.currency === currency)?.amount ?? 0;
}

function formatSignedPercent(pct: number | null): string {
  if (pct === null) return "Not enough history";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct}%`;
}

/** Multi-segment bar for assets, one segment per group, colored by identity. */
function AssetsBar({
  groups,
  total,
  currency,
}: Readonly<{ groups: GroupAmount[]; total: number; currency: string }>) {
  if (groups.length === 0 || total <= 0) return null;
  return (
    <div className="mt-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-panel-2" role="img" aria-label={`Assets by group for ${currency}`}>
        {groups.map((entry) => (
          <span
            key={entry.group}
            style={{
              width: `${Math.max(0, (entry.amount / total) * 100)}%`,
              backgroundColor: ASSET_GROUP_COLOR[entry.group] ?? "var(--viz-muted)",
            }}
          />
        ))}
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {groups.map((entry) => (
          <li key={entry.group} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-muted">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: ASSET_GROUP_COLOR[entry.group] ?? "var(--viz-muted)" }}
              />
              <span className="truncate">{entry.label}</span>
            </span>
            <span data-money className="shrink-0 font-semibold tabular-nums">
              {formatCurrency(entry.amount, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Single-color red bar for liabilities — Monarch does not split this one by group. */
function LiabilitiesBar({
  groups,
  currency,
}: Readonly<{ groups: GroupAmount[]; currency: string }>) {
  if (groups.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-panel-2">
        <span className="block h-full w-full bg-danger" />
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {groups.map((entry) => (
          <li key={entry.group} className="flex items-center justify-between gap-2 text-muted">
            <span className="truncate">{entry.label}</span>
            <span data-money className="shrink-0 font-semibold tabular-nums">
              {formatCurrency(entry.amount, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The right-rail balance-sheet card: headline per-currency figure, an
 * assets stacked bar (segmented by group) with a legend, a liabilities bar
 * (single red, per Monarch — not segmented), and the CSV export link.
 * `NetWorthHero` above still owns the headline number and its trend chart;
 * this keeps the per-currency detail plus the daily-balance table twin.
 */
export default function SummaryPanel({
  summary,
  mode,
  query = {},
  filtered = false,
  exportHref,
}: Readonly<{
  summary: Summary;
  mode: "totals" | "percent";
  query?: SummaryQuery;
  /** A filter is hiding rows below, but this balance sheet stays portfolio-wide. */
  filtered?: boolean;
  exportHref: string;
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
        <SegmentedControl
          ariaLabel="Balance sheet display"
          items={[
            { label: "Totals", href: summaryHref("totals"), active: mode === "totals" },
            { label: "Percent", href: summaryHref("percent"), active: mode === "percent" },
          ]}
        />
      }
    >
      {summary.currencyMismatch && (
        <p className="mb-4 rounded-field border border-warning/35 bg-warning/10 p-3 text-sm text-warning">
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

      <div className="space-y-4">
        {summary.currencies.map((currency) => {
          const monthChange = summary.netWorthMonthChange[currency];
          const netWorth = totalFor(summary.netWorth, currency);
          const percentLabel = formatSignedPercent(monthChange?.pct ?? null);
          const assetsTotal = totalFor(summary.assets, currency);
          const assetGroups = summary.assetsByGroup[currency] ?? [];
          const liabilityGroups = summary.liabilitiesByGroup[currency] ?? [];
          return (
            <div
              key={currency}
              className="rounded-field border border-panel-border bg-panel-2 p-4"
            >
              <p className="text-xs font-semibold text-muted">{currency}</p>
              <p data-money className="metric-value mt-2 text-2xl">
                {mode === "percent"
                  ? percentLabel
                  : formatCurrency(netWorth, currency)}
              </p>

              <p className="mt-4 flex items-center justify-between text-xs font-semibold text-muted">
                <span>Assets</span>
                <span data-money>{formatCurrency(assetsTotal, currency)}</span>
              </p>
              <AssetsBar groups={assetGroups} total={assetsTotal} currency={currency} />

              <p className="mt-4 flex items-center justify-between text-xs font-semibold text-muted">
                <span>Liabilities</span>
                <span data-money>
                  {formatCurrency(totalFor(summary.liabilities, currency), currency)}
                </span>
              </p>
              <LiabilitiesBar groups={liabilityGroups} currency={currency} />
            </div>
          );
        })}
      </div>

      <Link
        href={exportHref}
        className="mt-4 flex min-h-11 items-center justify-center text-sm font-semibold text-accent hover:underline"
      >
        Download CSV
      </Link>
    </Panel>
  );
}
