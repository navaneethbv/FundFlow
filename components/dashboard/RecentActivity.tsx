import { MerchantAvatar } from "@/components/ui/Avatar";
import CategoryChip from "@/components/ui/CategoryChip";
import { ChevronRight } from "@/components/ui/icons";
import { formatCurrency, titleCase } from "@/lib/format";
import { formatDate } from "@/lib/format-date";

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
}: Readonly<{
  transactions: RecentTransaction[];
  accountNames: Map<string, string>;
}>) {
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
            <MerchantAvatar name={merchant} size={36} className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{merchant}</span>
              <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                {transaction.pfc_primary ? (
                  <CategoryChip label={titleCase(transaction.pfc_primary)} />
                ) : (
                  <span>Uncategorized</span>
                )}
                <span className="truncate">· {accountNames.get(transaction.account_id) ?? "Account"}</span>
              </span>
            </span>
            <span className="text-right">
              <span
                data-money
                className={income ? "block text-sm font-bold text-success" : "block text-sm font-bold text-foreground"}
              >
                {income ? "+" : ""}
                {formatCurrency(Math.abs(transaction.amount), transaction.iso_currency_code ?? "USD")}
              </span>
              <span className="block text-xs text-muted">{formatDate(transaction.date)}</span>
            </span>
            <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted" />
          </li>
        );
      })}
    </ul>
  );
}
