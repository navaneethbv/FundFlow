import Link from "next/link";
import {
  dashboardUrl,
  subcategoryLabel,
  type CategoryDrilldownData,
} from "@/lib/drilldown";
import { foldTail } from "@/lib/chart-utils";
import { formatCurrency, formatMonth, titleCase } from "@/lib/format";
import DonutChart from "@/components/charts/DonutChart";
import TrendChart from "@/components/charts/TrendChart";
import BarList from "@/components/dashboard/BarList";
import Panel from "@/components/ui/Panel";

export interface DrillLinkParams {
  tab: string;
  month?: string;
  accountId?: string;
  itemId?: string;
}

function ledgerUrl(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return `/transactions?${search.toString()}`;
}

export default function CategoryDrilldownPanel({
  drill,
  linkParams,
  month,
}: {
  drill: CategoryDrilldownData;
  linkParams: DrillLinkParams;
  /** The resolved active month (data.selectedMonth), for ledger links. */
  month: string;
}) {
  const categoryLabel = titleCase(drill.category);
  const atSubLevel = drill.sub !== null;
  const donutItems = foldTail(
    drill.subcategories.map((s) => ({
      label: s.label,
      amount: s.amount,
      href: atSubLevel
        ? undefined
        : dashboardUrl({ ...linkParams, category: drill.category, sub: s.key }),
    })),
    6,
    (amount) => ({ label: "Other", amount, href: undefined }),
  );
  const maxMerchant = Math.max(1, ...drill.merchants.map((m) => m.amount));
  const deltaLabel = `${drill.momDelta >= 0 ? "+" : "-"}${formatCurrency(Math.abs(drill.momDelta))} vs last month`;

  return (
    <Panel
      eyebrow="Drill-down"
      title={
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-normal">
          <Link href={dashboardUrl(linkParams)} className="text-accent hover:underline">
            All categories
          </Link>
          <span aria-hidden className="text-muted">/</span>
          {atSubLevel ? (
            <>
              <Link
                href={dashboardUrl({ ...linkParams, category: drill.category })}
                className="text-accent hover:underline"
              >
                {categoryLabel}
              </Link>
              <span aria-hidden className="text-muted">/</span>
              <span className="font-semibold">{subcategoryLabel(drill.category, drill.sub!)}</span>
            </>
          ) : (
            <span className="font-semibold">{categoryLabel}</span>
          )}
        </span>
      }
      action={
        <span className="text-xs font-bold text-muted">
          {formatCurrency(drill.total)} · {deltaLabel}
        </span>
      }
    >
      <div className="space-y-5">
        {!atSubLevel && drill.subcategories.length > 0 && (
          <DonutChart items={donutItems} centerLabel="in category" />
        )}

        <div>
          <h4 className="eyebrow mb-2">Top merchants</h4>
          <BarList
            items={drill.merchants.map((m) => ({
              label: m.merchant,
              amount: m.amount,
              href: dashboardUrl({ ...linkParams, merchant: m.merchant }),
            }))}
            max={maxMerchant}
          />
        </div>

        <div>
          <h4 className="eyebrow mb-2">6-month trend</h4>
          <TrendChart
            labels={drill.trend.map((t) => formatMonth(t.month))}
            links={drill.trend.map((t) =>
              dashboardUrl({
                ...linkParams,
                month: t.month,
                category: drill.category,
                sub: drill.sub ?? undefined,
              }),
            )}
            series={[{ name: categoryLabel, slot: 1, values: drill.trend.map((t) => t.amount) }]}
          />
        </div>

        <div>
          <h4 className="eyebrow mb-2">Transactions</h4>
          <ul className="divide-y divide-panel-border text-sm">
            {drill.transactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  <span className="block font-medium">{t.merchant}</span>
                  <span className="block text-xs text-muted">{t.date}</span>
                </span>
                <span className="tabular-nums font-semibold">{formatCurrency(t.amount)}</span>
              </li>
            ))}
            {drill.transactions.length === 0 && (
              <li className="py-3 text-sm text-muted">No transactions this month.</li>
            )}
          </ul>
          <Link
            href={ledgerUrl({
              month,
              accountId: linkParams.accountId,
              category: drill.category,
              sub: drill.sub ?? undefined,
            })}
            className="mt-2 inline-block text-xs font-semibold text-accent hover:underline"
          >
            View all in Ledger
          </Link>
        </div>
      </div>
    </Panel>
  );
}
