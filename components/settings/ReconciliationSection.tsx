import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import type { AccountReconciliation, ReconciliationState } from "@/lib/sync-health";

function stateDisplay(state: ReconciliationState): { label: string; tone: BadgeTone } {
  switch (state) {
    case "balanced":
      return { label: "Balanced", tone: "success" };
    case "difference":
      return { label: "Review difference", tone: "warning" };
    case "missing_anchor":
      return { label: "Building history", tone: "neutral" };
    case "incomplete_history":
      return { label: "History incomplete", tone: "warning" };
    default:
      return { label: "Balance unavailable", tone: "neutral" };
  }
}

function money(value: number | null): React.ReactNode {
  return value === null ? (
    <span className="text-muted">Not available</span>
  ) : (
    <span data-money className="money">
      {formatCurrency(value)}
    </span>
  );
}

function AccountLabel({ row }: Readonly<{ row: AccountReconciliation }>) {
  const coverage = row.oldestTransactionDate && row.newestTransactionDate
    ? `${row.oldestTransactionDate} to ${row.newestTransactionDate}`
    : "Transaction coverage not available";
  return (
    <span>
      <span className="block font-semibold">{row.accountName}</span>
      {row.mask && <span className="block text-xs text-muted">Ending in {row.mask}</span>}
      <span className="mt-1 block text-xs text-muted">{coverage}</span>
      <span className="block text-xs text-muted">Balance refreshed: {row.accountsUpdatedAt ?? "not available"}</span>
    </span>
  );
}

export default function ReconciliationSection({
  rows,
}: Readonly<{ rows: AccountReconciliation[] }>) {
  return (
    <Panel title="Account reconciliation" eyebrow="Coverage and balances" padding="none">
      <div className="px-5 pb-4">
        <p className="text-sm text-muted">
          Provider balance is the latest balance reported by your institution.
          Ledger balance is calculated only from a saved balance snapshot plus complete transaction history after that date.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">No connected accounts to reconcile.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-y border-panel-border bg-panel-2 text-xs text-muted">
                  <th scope="col" className="px-5 py-3 font-semibold">Account</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Provider balance</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Ledger balance</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Difference</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const display = stateDisplay(row.state);
                  return (
                    <tr key={row.accountId} className="border-b border-panel-border last:border-b-0">
                      <th scope="row" className="px-5 py-4"><AccountLabel row={row} /></th>
                      <td className="px-3 py-4 text-right">{money(row.providerBalance)}</td>
                      <td className="px-3 py-4 text-right">{money(row.ledgerBalance)}</td>
                      <td className="px-3 py-4 text-right">{money(row.difference)}</td>
                      <td className="px-5 py-4"><Badge tone={display.tone}>{display.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 px-5 pb-5 md:hidden" aria-label="Account reconciliation details">
            {rows.map((row) => {
              const display = stateDisplay(row.state);
              return (
                <li key={row.accountId} className="rounded-field border border-panel-border bg-panel-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <AccountLabel row={row} />
                    <Badge tone={display.tone}>{display.label}</Badge>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-xs text-muted">Provider balance</dt><dd>{money(row.providerBalance)}</dd></div>
                    <div><dt className="text-xs text-muted">Ledger balance</dt><dd>{money(row.ledgerBalance)}</dd></div>
                    <div><dt className="text-xs text-muted">Difference</dt><dd>{money(row.difference)}</dd></div>
                    <div><dt className="text-xs text-muted">History starts</dt><dd>{row.anchorDate ?? "Not available"}</dd></div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}
