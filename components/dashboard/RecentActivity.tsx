import { formatCurrency, titleCase } from "@/lib/format";

export type RecentTransaction = {
  id: string;
  date: string;
  amount: number;
  iso_currency_code: string | null;
  merchant_name: string | null;
  name: string | null;
  pfc_primary: string | null;
  account_id: string;
};

export default function RecentActivity({
  transactions,
  accountNames,
}: {
  transactions: RecentTransaction[];
  accountNames: Map<string, string>;
}) {
  if (transactions.length === 0) {
    return <p className="py-4 text-sm text-muted">No recent activity yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {transactions.map((transaction) => {
        const merchant = transaction.merchant_name ?? transaction.name ?? "Unknown";
        const income = transaction.amount < 0;
        return (
          <li key={transaction.id} className="flex items-center gap-3 rounded-field p-2 hover:bg-panel-hover">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-field bg-accent-soft text-sm font-black text-accent">
              {merchant.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{merchant}</span>
              <span className="block truncate text-xs text-muted">
                {titleCase(transaction.pfc_primary) || "Uncategorized"} - {accountNames.get(transaction.account_id) ?? "Account"}
              </span>
            </span>
            <span className="text-right">
              <span className={income ? "block text-sm font-bold text-success" : "block text-sm font-bold text-danger"}>
                {income ? "+" : "-"}
                {formatCurrency(Math.abs(transaction.amount), transaction.iso_currency_code ?? "USD")}
              </span>
              <span className="block text-xs text-muted">{transaction.date}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
