import Link from "next/link";
import RecentActivity from "@/components/dashboard/RecentActivity";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import type { ComponentProps } from "react";

export default function TransactionsWidget({
  transactions,
  accountNames,
  error = null,
}: Readonly<{
  transactions: ComponentProps<typeof RecentActivity>["transactions"];
  accountNames: Map<string, string>;
  error?: string | null;
}>) {
  return (
    <WidgetShell
      title="Recent transactions"
      hint="Latest activity"
      error={error}
      action={
        <Link
          href="/transactions"
          className="text-sm font-semibold text-accent hover:underline"
        >
          Ledger
        </Link>
      }
    >
      {/* RecentActivity carries its own empty state, so no `empty` here. */}
      <RecentActivity transactions={transactions} accountNames={accountNames} />
    </WidgetShell>
  );
}
