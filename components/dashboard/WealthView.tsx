import type { DashboardData } from "@/lib/dashboard";
import { formatCurrency, formatMonth, titleCase } from "@/lib/format";
import DivergingColumns from "@/components/charts/DivergingColumns";
import TrendChart from "@/components/charts/TrendChart";
import BarList from "@/components/dashboard/BarList";
import CardCarousel from "@/components/dashboard/CardCarousel";
import Panel from "@/components/ui/Panel";

function MetricPanel({
  title,
  value,
  tone,
}: {
  title: string;
  value: number;
  tone?: "success" | "danger";
}) {
  return (
    <Panel title={title}>
      <p
        className={
          tone === "success"
            ? "metric-value text-2xl text-success"
            : tone === "danger"
              ? "metric-value text-2xl text-danger"
              : "metric-value text-2xl"
        }
      >
        {value > 0 && title === "Net cash flow" ? "+" : ""}
        {formatCurrency(value)}
      </p>
    </Panel>
  );
}

export default function WealthView({
  data,
  selectedAccountId,
  selectedMonth,
}: {
  data: DashboardData;
  selectedAccountId?: string;
  selectedMonth?: string;
}) {
  const cardItems = data.spendPerCard.map((item) => ({
    label: item.name,
    amount: item.amount,
  }));
  const bankItems = data.spendPerBank.map((item) => ({
    label: item.name,
    amount: item.amount,
  }));
  const maxCard = Math.max(1, ...cardItems.map((item) => item.amount));
  const maxBank = Math.max(1, ...bankItems.map((item) => item.amount));
  const depositoryAccounts = data.accounts.filter(
    (account) => account.type === "depository",
  );
  const history = data.netWorthHistory;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-12">
        <Panel
          title="Net worth"
          eyebrow="Balance-sheet trend"
          className="xl:col-span-8"
        >
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <p className="metric-value text-3xl">
              {formatCurrency(data.netWorthSnapshot.netWorth)}
            </p>
            <span className="text-xs font-medium text-muted">
              {history.length} month{history.length === 1 ? "" : "s"} recorded
            </span>
          </div>
          <TrendChart
            labels={history.map((item) => formatMonth(item.month))}
            series={[
              {
                name: "Net worth",
                slot: 1,
                values: history.map((item) => item.netWorth),
              },
            ]}
          />
        </Panel>

        <Panel title="Balance sheet" className="xl:col-span-4">
          <dl className="divide-y divide-panel-border">
            <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
              <dt className="text-sm text-muted">Assets</dt>
              <dd className="metric-value text-sm">
                {formatCurrency(data.netWorthSnapshot.assets)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-sm text-muted">Liabilities</dt>
              <dd className="metric-value text-sm text-danger">
                {formatCurrency(data.netWorthSnapshot.liabilities)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
              <dt className="text-sm font-semibold">Net worth</dt>
              <dd className="metric-value text-lg">
                {formatCurrency(data.netWorthSnapshot.netWorth)}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>

      <CardCarousel
        accounts={data.accounts}
        selectedAccountId={selectedAccountId}
        selectedMonth={selectedMonth}
        activeView="wealth"
      />

      {(cardItems.length > 0 || bankItems.length > 0) && (
        <div className="grid gap-5 xl:grid-cols-2">
          {cardItems.length > 0 && (
            <Panel title="Spend by card" eyebrow="Selected month">
              <BarList items={cardItems} max={maxCard} />
            </Panel>
          )}
          {bankItems.length > 0 && (
            <Panel title="Spend by bank" eyebrow="Selected month">
              <BarList items={bankItems} max={maxBank} />
            </Panel>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricPanel
          title="Deposits"
          value={data.cashFlow.deposits}
          tone="success"
        />
        <MetricPanel
          title="Withdrawals"
          value={data.cashFlow.withdrawals}
          tone="danger"
        />
        <MetricPanel
          title="Net cash flow"
          value={data.cashFlow.net}
          tone={data.cashFlow.net >= 0 ? "success" : "danger"}
        />
      </div>

      <Panel title="Cash flow history" eyebrow="Six-month movement">
        <DivergingColumns
          labels={data.monthlyCashFlow.map((month) => formatMonth(month.month))}
          up={data.monthlyCashFlow.map((month) => month.deposits)}
          down={data.monthlyCashFlow.map((month) => month.withdrawals)}
          upName="Deposits"
          downName="Withdrawals"
        />
      </Panel>

      {depositoryAccounts.length > 0 && (
        <Panel title="Depository accounts">
          <ul className="divide-y divide-panel-border">
            {depositoryAccounts.map((account) => (
              <li
                key={account.id}
                className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {account.name ?? "Checking"}
                    {account.mask ? ` ${account.mask}` : ""}
                  </span>
                  <span className="block text-xs text-muted">
                    {titleCase(account.subtype ?? "Depository")}
                  </span>
                </span>
                <span className="metric-value text-sm">
                  {formatCurrency(
                    account.current_balance,
                    account.iso_currency_code ?? "USD",
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
