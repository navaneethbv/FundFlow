import AreaSparkline from "@/components/charts/AreaSparkline";
import { formatCurrency } from "@/lib/format";
import type { AccountsPageRow } from "@/lib/accounts-page";

function formatChange(row: AccountsPageRow): string | null {
  if (!row.monthChange) return null;
  const amount = row.monthChange.amount;
  const amountLabel = `${amount >= 0 ? "+" : ""}${formatCurrency(
    amount,
    row.currency,
  )}`;
  if (row.monthChange.pct === null) return amountLabel;
  return `${amountLabel} (${row.monthChange.pct >= 0 ? "+" : ""}${
    row.monthChange.pct
  }%)`;
}

export default function AccountRow({
  row,
}: Readonly<{ row: AccountsPageRow }>) {
  const change = formatChange(row);
  return (
    <li className="grid gap-3 border-t border-panel-border px-4 py-4 first:border-t-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(8rem,0.8fr)_8rem_minmax(8rem,0.8fr)] sm:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{row.name}</p>
        <p className="mt-1 text-xs text-muted">
          {[row.institution, row.subtype ?? row.type]
            .filter(Boolean)
            .join(" · ") || "Manual account"}
        </p>
        <p
          className={
            row.stale
              ? "mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300"
              : "mt-1 text-xs text-muted"
          }
        >
          {row.stale
            ? `Stale, updated ${row.updatedAgo}`
            : `Updated ${row.updatedAgo}`}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted">Balance</p>
        <p data-money className="mt-1 font-mono text-sm font-bold tabular-nums">
          {row.balance === null
            ? "Unavailable"
            : formatCurrency(row.balance, row.currency)}
        </p>
      </div>
      <div
        className={
          row.spark.length < 2 ? "hidden min-h-11 sm:block" : "min-h-11"
        }
        aria-label={`${row.name} balance trend`}
      >
        <AreaSparkline values={row.spark} />
      </div>
      <div>
        <p className="text-xs text-muted">30-day change</p>
        <p className="mt-1 text-sm font-semibold tabular-nums">
          {change ?? "Not enough history"}
        </p>
      </div>
    </li>
  );
}
