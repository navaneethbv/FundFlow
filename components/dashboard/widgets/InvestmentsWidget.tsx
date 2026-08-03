import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import DropdownButton from "@/components/ui/DropdownButton";
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
 *
 * Monarch's populated header also shows a same-day dollar change ("$43,590
 * investments  $0.00 Today") and a "Top movers today" strip below the total —
 * both need per-holding day-change data this widget doesn't receive today
 * (the dashboard loader only fetches asset-class totals, not
 * `investment-performance.ts`'s day-change figures). Deferred rather than
 * faked with a placeholder "$0.00".
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
      error={error}
      empty={
        totals.length === 0
          ? "No investment holdings yet. Sync another account to see them here."
          : null
      }
      action={
        <DropdownButton
          label="Holdings"
          items={[{ label: "Open Investments", href: "/investments" }]}
        />
      }
    >
      <p data-money className="metric-value text-2xl sm:text-3xl">
        {formatCurrency(total, currency)}
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {totals.map((entry) => (
          <li key={entry.label} className="flex justify-between gap-3">
            <span className="truncate text-muted">{entry.label}</span>
            <span data-money className="tabular-nums">
              {formatCurrency(entry.value, currency)}
            </span>
          </li>
        ))}
      </ul>
    </WidgetShell>
  );
}
