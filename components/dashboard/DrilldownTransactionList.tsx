import { formatCurrency } from "@/lib/format";
import type { DrillTxn } from "@/lib/drilldown";

export default function DrilldownTransactionList({
  transactions,
  emptyLabel,
}: Readonly<{
  transactions: DrillTxn[];
  emptyLabel: string;
}>) {
  return (
    <ul className="divide-y divide-panel-border text-sm">
      {transactions.map((transaction) => (
        <li key={transaction.id} className="flex items-center justify-between gap-4 py-2">
          <span>
            <span className="block font-medium">{transaction.merchant}</span>
            <span className="block text-xs text-muted">{transaction.date}</span>
          </span>
          <span className="tabular-nums font-semibold">{formatCurrency(transaction.amount)}</span>
        </li>
      ))}
      {transactions.length === 0 && <li className="py-3 text-sm text-muted">{emptyLabel}</li>}
    </ul>
  );
}
