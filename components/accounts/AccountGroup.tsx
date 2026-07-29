import AccountRow from "@/components/accounts/AccountRow";
import { formatCurrency } from "@/lib/format";
import type {
  AccountGroupKey,
  AccountsPageData,
} from "@/lib/accounts-page";

export default function AccountGroup({
  groupKey,
  group,
}: Readonly<{
  groupKey: AccountGroupKey;
  group: AccountsPageData["groups"][AccountGroupKey];
}>) {
  if (group.rows.length === 0) return null;

  return (
    <details
      open
      className="overflow-hidden rounded-card border border-panel-border bg-panel shadow-card"
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 focus-visible:outline-2">
        <span>
          <span className="block text-sm font-bold">{group.label}</span>
          <span className="block text-xs text-muted">
            {group.rows.length} account{group.rows.length === 1 ? "" : "s"}
          </span>
        </span>
        <span className="flex flex-wrap justify-end gap-2">
          {group.totals.map((total) => (
            <span
              key={`${groupKey}-${total.currency}`}
              className="rounded-full bg-panel-2 px-2.5 py-1 font-mono text-xs font-bold tabular-nums"
            >
              {formatCurrency(total.amount, total.currency)}
            </span>
          ))}
        </span>
      </summary>
      <ul>
        {group.rows.map((row) => (
          <AccountRow key={`${row.source}-${row.id}`} row={row} />
        ))}
      </ul>
    </details>
  );
}
