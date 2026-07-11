import Link from "next/link";
import { donutSegments, compactCurrency } from "@/lib/chart-utils";

export interface DonutItem {
  label: string;
  amount: number;
  /** When set, the slice and its legend row become links. */
  href?: string;
}

/**
 * Part-to-whole donut, ≤6 segments (fold the tail into "Other" upstream with
 * foldTail). Segments are separated by 2px surface gaps (never strokes); the
 * legend lists every label + value — the visible-labels relief the palette
 * validator requires for the low-contrast light slots — so color never works
 * alone. Center carries the total.
 */
export default function DonutChart({
  items,
  centerLabel,
  valueFormatter = compactCurrency,
}: {
  items: DonutItem[];
  centerLabel: string;
  valueFormatter?: (v: number) => string;
}) {
  const SIZE = 184;
  const C = SIZE / 2;
  const total = items.reduce((a, b) => a + Math.max(0, b.amount), 0);
  const segments = donutSegments(items, (i) => i.amount, C, C, 84, 56);

  if (segments.length === 0) {
    return <p className="text-sm opacity-60 py-4">No data yet.</p>;
  }

  const slotOf = (item: DonutItem) => items.indexOf(item) + 1;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-44 h-44 flex-shrink-0"
        role="img"
        aria-label={`${centerLabel} breakdown`}
      >
        {segments.map((s) => {
          const slice = (
            <path key={s.item.label} d={s.path} fill={`var(--viz-${slotOf(s.item)})`}>
              <title>
                {`${s.item.label}: ${valueFormatter(s.item.amount)} (${Math.round(
                  (s.item.amount / total) * 100,
                )}%)`}
              </title>
            </path>
          );
          return s.item.href ? (
            <a
              key={s.item.label}
              href={s.item.href}
              aria-label={`${s.item.label}: ${valueFormatter(s.item.amount)}`}
              className="focus-visible:outline-2"
            >
              {slice}
            </a>
          ) : (
            slice
          );
        })}
        <text
          x={C}
          y={C - 4}
          textAnchor="middle"
          fontSize={20}
          fontWeight={600}
          fill="var(--viz-ink)"
        >
          {valueFormatter(total)}
        </text>
        <text x={C} y={C + 14} textAnchor="middle" fontSize={9.5} fill="var(--viz-muted)">
          {centerLabel}
        </text>
      </svg>

      <ul className="w-full space-y-1.5 text-sm">
        {items.map((item, i) => {
          const row = (
            <>
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: `var(--viz-${i + 1})` }}
              />
              <span className="truncate" style={{ color: "var(--viz-ink-2)" }}>
                {item.label}
              </span>
              <span
                className="ml-auto tabular-nums font-medium"
                style={{ color: "var(--viz-ink)" }}
              >
                {valueFormatter(item.amount)}
              </span>
              <span className="w-10 text-right tabular-nums text-xs" style={{ color: "var(--viz-muted)" }}>
                {total > 0 ? `${Math.round((item.amount / total) * 100)}%` : ""}
              </span>
            </>
          );
          return (
            <li key={item.label}>
              {item.href ? (
                <Link
                  href={item.href}
                  className="flex items-center gap-2 rounded-field p-1 -m-1 hover:bg-panel-hover focus-visible:outline-2"
                >
                  {row}
                </Link>
              ) : (
                <span className="flex items-center gap-2 p-1 -m-1">{row}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
