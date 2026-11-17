import type { ComponentProps } from "react";
import RecentActivity from "@/components/dashboard/RecentActivity";
import WidgetChoice from "@/components/dashboard/widgets/WidgetChoice";

export default function TransactionsWidget({
  transactions,
  accountNames,
  viewerId,
  error = null,
}: Readonly<{
  transactions: ComponentProps<typeof RecentActivity>["transactions"];
  accountNames: Map<string, string>;
  viewerId?: string;
  error?: string | null;
}>) {
  return <WidgetChoice title="Transactions" label="Recent transaction direction" error={error} options={[
    { value: "all", label: "All transactions", content: <RecentActivity transactions={transactions} accountNames={accountNames} viewerId={viewerId} /> },
    { value: "in", label: "Money in", content: <RecentActivity transactions={transactions.filter(row => row.amount < 0)} accountNames={accountNames} viewerId={viewerId} /> },
    { value: "out", label: "Money out", content: <RecentActivity transactions={transactions.filter(row => row.amount > 0)} accountNames={accountNames} viewerId={viewerId} /> },
  ]} />;
}
