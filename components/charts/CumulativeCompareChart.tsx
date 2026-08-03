import { areaPath, compactCurrency, linePath, niceTicks } from "@/lib/chart-utils";
import type { CumulativeSpendDay } from "@/lib/dashboard";

/**
 * Cumulative spend this month against last month, aligned by day.
 *
 * Server-rendered SVG, no client JS, same contract as the rest of
 * `components/charts/`. Two rules from the data shape are load-bearing here:
 *
 *   * A null never becomes a point. `thisMonth` is null for days that have not
 *     happened, so the accent line stops at today rather than diving to zero;
 *     `lastMonth` is null past a shorter previous month's final day, so that
 *     line simply ends instead of flattening.
 *   * The table twin *does* carry the previous month's final value forward,
 *     because a reader scanning rows needs a number, and "same as day 28" is
 *     true — it just is not a data point worth plotting.
 *
 * This month is the money-accent orange (line + gradient area fill,
 * matching Monarch); last month is a plain grey line — the two series
 * differ in lightness/saturation as well as which one carries a fill.
 */

const WIDTH = 640;
const HEIGHT = 200;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 10;
const PAD_BOTTOM = 22;

interface Point {
  x: number;
  y: number;
}

export default function CumulativeCompareChart({
  days,
  monthLabel,
  previousMonthLabel,
  valueFormatter = compactCurrency,
}: Readonly<{
  days: CumulativeSpendDay[];
  monthLabel: string;
  previousMonthLabel: string;
  valueFormatter?: (value: number) => string;
}>) {
  if (days.length === 0) {
    return <p className="py-4 text-sm opacity-60">No spending yet.</p>;
  }

  const values = days.flatMap((row) =>
    [row.thisMonth, row.lastMonth].filter((value): value is number => value !== null),
  );
  const ticks = niceTicks(Math.max(...values, 0));
  const maxTick = ticks.at(-1) || 1;

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const xFor = (day: number) =>
    PAD_LEFT + ((day - 1) / Math.max(1, days.length - 1)) * plotWidth;
  const yFor = (value: number) =>
    PAD_TOP + plotHeight - (value / maxTick) * plotHeight;

  const pointsFor = (pick: (row: CumulativeSpendDay) => number | null): Point[] =>
    days
      .filter((row) => pick(row) !== null)
      .map((row) => ({ x: xFor(row.day), y: yFor(pick(row)!) }));

  const thisPoints = pointsFor((row) => row.thisMonth);
  const lastPoints = pointsFor((row) => row.lastMonth);
  const endpoint = thisPoints.at(-1);
  const endpointValue = days.filter((row) => row.thisMonth !== null).at(-1);

  // The previous month's last real value, for the table's forward fill.
  const lastMonthFinal =
    [...days].reverse().find((row) => row.lastMonth !== null)?.lastMonth ?? null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Cumulative spending, ${monthLabel} against ${previousMonthLabel}. The data table below carries the same figures.`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yFor(tick)}
              y2={yFor(tick)}
              stroke="var(--viz-grid)"
              strokeWidth={1}
            />
            <text
              x={PAD_LEFT - 6}
              y={yFor(tick) + 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--viz-muted)"
              className="money"
            >
              {valueFormatter(tick)}
            </text>
          </g>
        ))}

        {lastPoints.length > 1 && (
          <path
            d={linePath(lastPoints)}
            fill="none"
            stroke="var(--viz-muted)"
            strokeWidth={2}
          >
            <title>{previousMonthLabel}</title>
          </path>
        )}

        {thisPoints.length > 1 && (
          <>
            <path
              d={areaPath(thisPoints, PAD_TOP + plotHeight)}
              fill="var(--accent)"
              fillOpacity={0.16}
            />
            <path
              d={linePath(thisPoints)}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
            >
              <title>{monthLabel}</title>
            </path>
          </>
        )}

        {endpoint && endpointValue?.thisMonth !== null && endpointValue && (
          <>
            <circle cx={endpoint.x} cy={endpoint.y} r={3.5} fill="var(--accent)" />
            <text
              x={Math.min(endpoint.x + 6, WIDTH - PAD_RIGHT)}
              y={Math.max(endpoint.y - 6, PAD_TOP + 8)}
              textAnchor="end"
              fontSize={10}
              fontWeight={600}
              fill="var(--viz-ink)"
              className="money"
            >
              {valueFormatter(endpointValue.thisMonth)}
            </text>
          </>
        )}

        <text
          x={PAD_LEFT}
          y={HEIGHT - 6}
          fontSize={9}
          fill="var(--viz-muted)"
        >
          Day 1
        </text>
        <text
          x={WIDTH - PAD_RIGHT}
          y={HEIGHT - 6}
          textAnchor="end"
          fontSize={9}
          fill="var(--viz-muted)"
        >
          Day {days.length}
        </text>
      </svg>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 flex-shrink-0"
            style={{ background: "var(--viz-muted)" }}
          />
          <span style={{ color: "var(--viz-ink-2)" }}>{previousMonthLabel}</span>
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 flex-shrink-0"
            style={{ background: "var(--accent)" }}
          />
          <span style={{ color: "var(--viz-ink-2)" }}>{monthLabel}</span>
        </li>
      </ul>

      <details className="mt-1">
        <summary
          className="cursor-pointer text-xs"
          style={{ color: "var(--viz-muted)" }}
        >
          View data table
        </summary>
        <table className="mt-2 w-full text-xs">
          <caption className="sr-only">
            Cumulative spending by day for {monthLabel} and {previousMonthLabel}.
          </caption>
          <thead>
            <tr className="text-left opacity-60">
              <th className="py-1 pr-2 font-medium">Day</th>
              <th className="py-1 pr-2 font-medium">{monthLabel}</th>
              <th className="py-1 pr-2 font-medium">{previousMonthLabel}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {days.map((row) => (
              <tr
                key={row.day}
                className="border-t border-black/5 dark:border-white/10"
              >
                <td className="py-1 pr-2">{row.day}</td>
                <td data-money className="py-1 pr-2">
                  {row.thisMonth === null ? "—" : valueFormatter(row.thisMonth)}
                </td>
                <td data-money className="py-1 pr-2">
                  {/* Forward-filled: the previous month ended, so its total did
                      not change. Plotting it would imply a day that existed. */}
                  {row.lastMonth === null
                    ? lastMonthFinal === null
                      ? "—"
                      : valueFormatter(lastMonthFinal)
                    : valueFormatter(row.lastMonth)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
