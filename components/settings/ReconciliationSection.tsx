import Panel from "@/components/ui/Panel";
import Badge from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/format";
import type { AccountReconciliationRow } from "@/lib/reconcile-data";

export default function ReconciliationSection({
  rows,
}: Readonly<{
  rows: AccountReconciliationRow[];
}>) {
  return (
    <Panel
      title="Financial reconciliation"
      eyebrow="Coverage & Reconciliation"
    >
      <p className="mb-4 text-xs text-muted">
        Compare connected institution balances with synchronized transaction history. Provider balances reflect current institution figures, while ledger totals reflect imported transactions within the historical coverage window.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No accounts available to reconcile.</p>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm" aria-label="Account reconciliation table">
              <thead>
                <tr className="border-b border-panel-border text-xs font-semibold uppercase tracking-wider text-muted">
                  <th scope="col" className="py-2.5 pr-4">Account</th>
                  <th scope="col" className="py-2.5 px-4 text-right">Provider Balance</th>
                  <th scope="col" className="py-2.5 px-4 text-right">Ledger Total</th>
                  <th scope="col" className="py-2.5 px-4 text-right">Difference</th>
                  <th scope="col" className="py-2.5 px-4">Coverage Window</th>
                  <th scope="col" className="py-2.5 pl-4 text-right">Freshness</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-panel-border">
                {rows.map((row) => {
                  const hasDifference = Math.abs(row.difference) > 0.01;
                  return (
                    <tr key={row.accountId} className="hover:bg-panel-hover">
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-foreground">{row.accountName}</div>
                        <div className="text-xs text-muted">
                          {row.institutionName} · {row.type}
                          {row.subtype ? ` (${row.subtype})` : ""}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {formatCurrency(row.providerBalance, row.currency)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-muted">
                        {formatCurrency(row.calculatedLedgerBalance, row.currency)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {hasDifference ? (
                          <span className="font-medium text-warning">
                            {formatCurrency(row.difference, row.currency)}
                          </span>
                        ) : (
                          <span className="text-success">$0.00</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-muted">
                        {row.coverageStart && row.coverageEnd ? (
                          <span>
                            {row.coverageStart} → {row.coverageEnd} ({row.transactionCount} txns)
                          </span>
                        ) : (
                          <span>No transactions ({row.transactionCount})</span>
                        )}
                      </td>
                      <td className="py-3 pl-4 text-right">
                        <Badge tone={row.isStale ? "warning" : "success"} className="px-2 py-0.5 text-[11px]">
                          {row.isStale ? "Stale (>48h)" : "Fresh"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card Twin */}
          <div className="space-y-3 md:hidden" aria-label="Account reconciliation list">
            {rows.map((row) => {
              const hasDifference = Math.abs(row.difference) > 0.01;
              return (
                <div
                  key={row.accountId}
                  className="rounded-field border border-panel-border bg-panel-2 p-3 text-sm space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-foreground">{row.accountName}</div>
                      <div className="text-xs text-muted">
                        {row.institutionName} · {row.type}
                      </div>
                    </div>
                    <Badge tone={row.isStale ? "warning" : "success"} className="px-2 py-0.5 text-[11px]">
                      {row.isStale ? "Stale" : "Fresh"}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-panel-border">
                    <div>
                      <span className="text-muted block">Provider Balance</span>
                      <span className="font-semibold tabular-nums">
                        {formatCurrency(row.providerBalance, row.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted block">Ledger Total</span>
                      <span className="text-muted tabular-nums">
                        {formatCurrency(row.calculatedLedgerBalance, row.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted block">Difference</span>
                      <span className={`tabular-nums font-medium ${hasDifference ? "text-warning" : "text-success"}`}>
                        {formatCurrency(row.difference, row.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted block">Tx Count</span>
                      <span className="text-muted">{row.transactionCount} txns</span>
                    </div>
                  </div>

                  {row.coverageStart && row.coverageEnd && (
                    <div className="text-[11px] text-muted border-t border-panel-border pt-1">
                      Coverage: {row.coverageStart} → {row.coverageEnd}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-field bg-panel-2 p-3 text-xs text-muted space-y-1">
            <p className="font-semibold text-foreground">Why do balances differ?</p>
            <p>
              Connected banks report instantaneous balances that include pending transactions and prior historical periods beyond the synchronized transaction window. A difference is expected when historical sync starts at a specific cutoff date or when pending transactions have not yet posted.
            </p>
          </div>
        </>
      )}
    </Panel>
  );
}
