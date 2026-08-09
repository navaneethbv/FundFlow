import AreaSparkline from "@/components/charts/AreaSparkline";
import { InstitutionAvatar } from "@/components/ui/Avatar";
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
    <li className="grid gap-3 border-t border-panel-border px-4 py-4 first:border-t-0 sm:grid-cols-[minmax(0,1.3fr)_7rem_7rem_minmax(8rem,0.8fr)] sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <InstitutionAvatar name={row.institution ?? row.name} size={32} className="shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <p className="mt-1 text-xs text-muted">
            {row.subtype ?? row.type ?? "Manual account"}
          </p>
        </div>
      </div>
      {/* `role="img"` is what makes the label real: `aria-label` is prohibited
          on a bare div (role `generic`) and assistive tech drops it, so these
          two charts were shipping with no text alternative at all. Matches the
          idiom already used in SummaryPanel and NetWorthHero. */}
      <div
        className={row.spark.length < 2 ? "hidden min-h-11 sm:block" : "min-h-11"}
        role="img"
        aria-label={`${row.name} 30-day trend`}
      >
        <AreaSparkline values={row.spark} />
      </div>
      <div
        className={row.sparkLong.length < 2 ? "hidden min-h-11 sm:block" : "min-h-11"}
        role="img"
        aria-label={`${row.name} full-history trend`}
      >
        <AreaSparkline values={row.sparkLong} />
      </div>
      <div className="text-left sm:text-right">
        <p data-money className="font-mono text-sm font-bold tabular-nums">
          {row.balance === null
            ? "Unavailable"
            : formatCurrency(row.balance, row.currency)}
        </p>
        <p
          className={
            row.stale
              ? "mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300"
              : "mt-1 text-xs text-muted"
          }
        >
          {row.stale ? `Stale, updated ${row.updatedAgo}` : row.updatedAgo}
        </p>
        <p className="mt-1 text-xs text-muted tabular-nums">
          {change ?? "Not enough history"}
        </p>
      </div>
    </li>
  );
}
