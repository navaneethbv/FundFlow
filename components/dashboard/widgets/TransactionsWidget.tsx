import type { ComponentProps } from "react";
import RecentActivity from "@/components/dashboard/RecentActivity";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import DropdownButton from "@/components/ui/DropdownButton";

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
  return (
    <WidgetShell
      title="Transactions"
      error={error}
      action={
        <DropdownButton
          label="All transactions"
          items={[{ label: "Open the ledger", href: "/transactions" }]}
        />
      }
    >
      {/* RecentActivity carries its own empty state, so no `empty` here. */}
      <RecentActivity transactions={transactions} accountNames={accountNames} viewerId={viewerId} />
    </WidgetShell>
  );
}
