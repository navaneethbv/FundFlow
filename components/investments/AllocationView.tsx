import { foldTail } from "@/lib/chart-utils";
import { formatCurrency } from "@/lib/format";
import type { InvestmentsPage } from "@/lib/investments";

/**
 * Slot colors mirror the chart palette's fixed order, not the asset class's
 * name — a hue is never reassigned to a different label between renders.
 * At most 7 slices (6 classes + "Other" via foldTail) to never cycle or exceed palette.
 */
const SLOT_COLORS = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--viz-6)",
  "var(--viz-ink-2)",
];

export default function AllocationView({
  page,
  currency,
}: Readonly<{ page: InvestmentsPage; currency: string }>) {
  if (page.total === 0) {
    return <p className="text-sm text-muted">Add a holding to see how your portfolio is allocated.</p>;
  }

  const items = foldTail(
    page.byClass.map((g) => ({ label: g.label, amount: g.subtotal, holdings: g.holdings })),
    7,
    (amount) => ({ label: "Other", amount, holdings: [] }),
  );

  return (
    <div className="space-y-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-panel">
        {items.map((group, i) => (
          <div
            key={group.label}
            style={{
              width: `${(group.amount / page.total) * 100}%`,
              backgroundColor: SLOT_COLORS[i] ?? SLOT_COLORS.at(-1),
            }}
            title={`${group.label}: ${formatCurrency(group.amount, currency)}`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((group, i) => (
          <li key={group.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: SLOT_COLORS[i] ?? SLOT_COLORS.at(-1) }}
                aria-hidden
              />
              {group.label}
            </span>
            <span className="tabular-nums text-muted">
              <span data-money>{formatCurrency(group.amount, currency)}</span> · {((group.amount / page.total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
      {/* Table twin: same data, accessible without color. */}
      <table className="sr-only">
        <caption>Allocation by asset class</caption>
        <thead>
          <tr>
            <th>Class</th>
            <th>Value</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {page.byClass.map((group) => (
            <tr key={group.label}>
              <td>{group.label}</td>
              <td>{formatCurrency(group.subtotal, currency)}</td>
              <td>{((group.subtotal / page.total) * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
