import type { DashboardData } from "@/lib/dashboard";
import { formatCurrency, formatMonth, titleCase } from "@/lib/format";
import DivergingColumns from "@/components/charts/DivergingColumns";
import Panel from "@/components/ui/Panel";

export default function CashflowTab({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel title="Deposits">
          <p className="display text-3xl text-success">{formatCurrency(data.cashFlow.deposits)}</p>
        </Panel>
        <Panel title="Withdrawals">
          <p className="display text-3xl text-danger">{formatCurrency(data.cashFlow.withdrawals)}</p>
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
