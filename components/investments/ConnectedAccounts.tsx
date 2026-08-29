import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import type { InvestmentAccountCoverage } from "@/lib/investments";

export default function ConnectedAccounts({
  coverage,
  currency = "USD",
}: Readonly<{
  coverage: InvestmentAccountCoverage;
  currency?: string;
}>) {
  return (
    <Panel
      title="Connected investment accounts"
      eyebrow="Account balances"
      padding="lg"
    >
      <div className="space-y-4">
        <div className="rounded-card border border-panel-border bg-panel-2 p-4 text-sm text-muted">
          <p className="font-semibold text-foreground">
            Security holdings unavailable
          </p>
          <p className="mt-1">
            These connected accounts report total balances directly from your
            institution. Individual security holdings, allocations, and share
            quantities have not been synchronized yet.
          </p>
        </div>

        <ul className="divide-y divide-panel-border">
          {coverage.accounts.map((acct) => (
            <li
              key={acct.id}
              className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
            >
              <div>
                <p className="text-sm font-semibold">{acct.name}</p>
                <p className="text-xs text-muted">
                  {acct.subtype ?? acct.type ?? "Investment account"} ·{" "}
                  {acct.source === "plaid" ? "Connected bank" : "Manual account"}
                </p>
              </div>
              <div className="text-right">
                <p data-money className="metric-value text-sm">
                  {acct.balance !== null
                    ? formatCurrency(acct.balance, acct.currency || currency)
                    : "—"}
                </p>
                <span className="inline-block rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                  {acct.valueSource === "holdings"
                    ? "From holdings"
                    : "Account balance"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
