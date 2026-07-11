import Link from "next/link";
import { dashboardUrl, type MerchantDrilldownData } from "@/lib/drilldown";
import { formatCurrency, formatMonth, titleCase } from "@/lib/format";
import TrendChart from "@/components/charts/TrendChart";
import Panel from "@/components/ui/Panel";
import type { DrillLinkParams } from "@/components/dashboard/CategoryDrilldownPanel";

export default function MerchantDrilldownPanel({
  drill,
  linkParams,
  month,
}: {
  drill: MerchantDrilldownData;
  linkParams: DrillLinkParams;
  month: string;
}) {
  const ledger = new URLSearchParams();
  ledger.set("month", month);
  if (linkParams.accountId) ledger.set("accountId", linkParams.accountId);
  ledger.set("merchant", drill.merchant);

  return (
    <Panel
      eyebrow="Merchant"
      title={
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-normal">
          <Link href={dashboardUrl(linkParams)} className="text-accent hover:underline">
            All categories
          </Link>
          <span aria-hidden className="text-muted">/</span>
          <span className="font-semibold">{drill.merchant}</span>
        </span>
      }
      action={
        <span className="text-xs font-bold text-muted">
          {formatCurrency(drill.total)} over 6 months
        </span>
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="eyebrow">Charges</dt>
            <dd className="mt-1 tabular-nums font-semibold">{drill.count}</dd>
          </div>
          <div>
            <dt className="eyebrow">Average</dt>
            <dd className="mt-1 tabular-nums font-semibold">{formatCurrency(drill.average)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Category</dt>
            <dd className="mt-1 font-semibold">
              {drill.dominantCategory ? (
                <Link
                  href={dashboardUrl({ ...linkParams, category: drill.dominantCategory })}
                  className="text-accent hover:underline"
                >
                  {titleCase(drill.dominantCategory)}
                </Link>
              ) : (
                "-"
              )}
            </dd>
          </div>
        </dl>

        <TrendChart
          labels={drill.trend.map((t) => formatMonth(t.month))}
          links={drill.trend.map((t) =>
            dashboardUrl({ ...linkParams, month: t.month, merchant: drill.merchant }),
          )}
          series={[{ name: drill.merchant, slot: 1, values: drill.trend.map((t) => t.amount) }]}
        />

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
              <li className="py-3 text-sm text-muted">No transactions in the window.</li>
            )}
          </ul>
          <Link
            href={`/transactions?${ledger.toString()}`}
            className="mt-2 inline-block text-xs font-semibold text-accent hover:underline"
          >
            View all in Ledger
          </Link>
        </div>
      </div>
    </Panel>
  );
}
