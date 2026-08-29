import { MerchantAvatar } from "@/components/ui/Avatar";
import { formatCurrency, roundsToZero } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import type { ReactNode } from "react";

function amountPrefix(amount: number): string {
  if (roundsToZero(amount)) return "";
  if (amount > 0) return "+";
  return "-";
}

/**
 * One row in a chronological money list — the shared shape behind Recent
 * Transactions and (as later phases adopt it) the transactions page's
 * ledger, report transactions, recurring items, and holdings.
 *
 * `amount` is already in display sign convention: positive is an inflow
 * (rendered with a leading "+", var(--viz-pos)); negative is an outflow
 * (var(--viz-neg)). Callers own converting from whatever raw sign
 * convention their data source uses (Plaid: positive = out) before
 * passing it in.
 */
export default function RegisterRow({
  index,
  merchant,
  meta,
  date,
  amount,
  currency = "USD",
  trailing,
}: Readonly<{
  index: number;
  merchant: string;
  meta?: ReactNode;
  date: string;
  amount: number;
  currency?: string;
  trailing?: ReactNode;
}>) {
  const inflow = amount > 0 && !roundsToZero(amount);
  const outflow = amount < 0 && !roundsToZero(amount);
  return (
    <li
      className={`flex items-center gap-3 p-2 hover:bg-panel-hover${
        index % 2 === 1 ? " bg-panel-2" : ""
      }`}
    >
      <MerchantAvatar name={merchant} size={36} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{merchant}</span>
        {meta && (
          <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">{meta}</span>
        )}
      </span>
      <span className="text-right">
        <span
          data-money
          className="block text-sm font-bold"
          style={
            inflow || outflow ? { color: inflow ? "var(--viz-pos)" : "var(--viz-neg)" } : undefined
          }
        >
          {amountPrefix(amount)}
          {formatCurrency(Math.abs(amount), currency)}
        </span>
        <span className="block text-xs text-muted font-mono">{formatDate(date)}</span>
      </span>
      {trailing}
    </li>
  );
}
