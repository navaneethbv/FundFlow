import Link from "next/link";
import type { DashboardData } from "@/lib/dashboard";
import { formatCurrency, formatMonth, titleCase } from "@/lib/format";
import { dashboardUrl } from "@/lib/drilldown";
import DivergingColumns from "@/components/charts/DivergingColumns";
import Panel from "@/components/ui/Panel";
import type { DrillLinkParams } from "@/components/dashboard/CategoryDrilldownPanel";

export default function CashflowTab({
  data,
  linkParams,
}: {
  data: DashboardData;
  linkParams: DrillLinkParams;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel title="Deposits">
          <Link
            href={`/transactions?month=${data.selectedMonth}&flow=in&accountType=depository`}
            className="block rounded-field hover:bg-panel-hover"
          >
            <p className="display text-3xl text-success">{formatCurrency(data.cashFlow.deposits)}</p>
          </Link>
        </Panel>
        <Panel title="Withdrawals">
          <Link
            href={`/transactions?month=${data.selectedMonth}&flow=out&accountType=depository`}
            className="block rounded-field hover:bg-panel-hover"
          >
            <p className="display text-3xl text-danger">{formatCurrency(data.cashFlow.withdrawals)}</p>
          </Link>
        </Panel>
        <Panel title="Net">
          <p className={data.cashFlow.net >= 0 ? "display text-3xl text-success" : "display text-3xl text-danger"}>
            {data.cashFlow.net >= 0 ? "+" : ""}
            {formatCurrency(data.cashFlow.net)}
          </p>
        </Panel>
      </div>

      <Panel title="Checking cash flow" eyebrow="Last 6 months">
        <DivergingColumns
          labels={data.monthlyCashFlow.map((m) => formatMonth(m.month))}
          links={data.monthlyCashFlow.map((m) => dashboardUrl({ ...linkParams, month: m.month }))}
          up={data.monthlyCashFlow.map((m) => m.deposits)}
          down={data.monthlyCashFlow.map((m) => m.withdrawals)}
          upName="Deposits"
          downName="Withdrawals"
        />
      </Panel>

      <Panel title="Depository accounts">
        <ul className="divide-y divide-panel-border text-sm">
          {data.accounts
            .filter((a) => a.type === "depository")
            .map((account) => (
              <li key={account.id} className="flex justify-between gap-4 py-3">
                <span>
                  {account.name ?? "Checking"}
                  {account.mask ? ` **${account.mask}` : ""}
                  <span className="ml-2 text-xs uppercase tracking-wide text-muted">
                    {titleCase(account.subtype ?? "")}
                  </span>
                </span>
                <span className="tabular-nums font-semibold">
                  {formatCurrency(account.current_balance, account.iso_currency_code ?? "USD")}
                </span>
              </li>
            ))}
        </ul>
      </Panel>
    </div>
  );
}
