import CategoryChip from "@/components/ui/CategoryChip";
import RegisterRow from "@/components/ui/RegisterRow";
import { ChevronRight } from "@/components/ui/icons";
import { titleCase } from "@/lib/format";

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
    <ul className="divide-y divide-panel-border">
      {transactions.map((transaction, index) => (
        <RegisterRow
          key={transaction.id}
          index={index}
          merchant={transaction.merchant_name ?? transaction.name ?? "Unknown"}
          date={transaction.date}
          amount={-transaction.amount}
          currency={transaction.iso_currency_code ?? "USD"}
          meta={
            <>
              {transaction.pfc_primary ? (
                <CategoryChip label={titleCase(transaction.pfc_primary)} />
              ) : (
                <span>Uncategorized</span>
              )}
              <span className="truncate">
                · {accountNames.get(transaction.account_id) ?? "Account"}
              </span>
            </>
          }
          trailing={<ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted" />}
        />
      ))}
    </ul>
  );
}
