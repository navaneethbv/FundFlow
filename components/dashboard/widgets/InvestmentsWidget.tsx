import Link from "next/link";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import { formatCurrency } from "@/lib/format";

export interface HoldingTotal {
  label: string;
  value: number;
}

/**
 * Investments. Phase 9A is what actually supplies holdings; until then this
 * renders the "sync another account" empty state the plan calls for rather
 * than being hidden, so the widget's existence is discoverable and the grid
 * layout does not shift when 9A lands.
 */
export default function InvestmentsWidget({
  totals = [],
  currency,
  error = null,
}: Readonly<{
  totals?: HoldingTotal[];
  currency: string;
  error?: string | null;
}>) {
  const total = totals.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <WidgetShell
      title="Investments"
      hint="Holdings"
      error={error}
      empty={
        totals.length === 0
          ? "No investment holdings yet. Sync another account to see them here."
          : null
      }
      action={
        <Link
          href="/accounts"
          className="text-sm font-semibold text-accent hover:underline"
        >
          Accounts
        </Link>
      }
    >
      <p className="metric-value text-2xl sm:text-3xl">
        {formatCurrency(total, currency)}
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {totals.map((entry) => (
          <li key={entry.label} className="flex justify-between gap-3">
            <span className="truncate text-muted">{entry.label}</span>
            <span className="tabular-nums">
              {formatCurrency(entry.value, currency)}
            </span>
          </li>
        ))}
      </ul>
    </WidgetShell>
  );
}
