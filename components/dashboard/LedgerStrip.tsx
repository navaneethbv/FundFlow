import Panel from "@/components/ui/Panel";
import Money from "@/components/ui/Money";
import { formatCurrency, formatMonth } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import type { LedgerTick } from "@/lib/ledger-strip";

/**
 * Vertical space reserved on each side of the axis line, in px. It has to fit
 * a full tick column: `MIN_STEM_HEIGHT + STEM_RANGE` of stem, the 8px dot, and
 * a three-line `leading-tight` label (~41px) plus its 4px gap. Labels sit in
 * normal flow, so anything less clips them against the `overflow-x-auto`
 * ancestor instead of just overlapping.
 */
const AXIS_OFFSET = 104;
const STRIP_HEIGHT = AXIS_OFFSET * 2;
const MIN_STEM_HEIGHT = 8;
const STEM_RANGE = 40;

function TickLabel({
  date,
  signedAmount,
  merchant,
  color,
  major,
  placement,
}: Readonly<{
  date: string;
  signedAmount: string;
  merchant: string;
  color: string;
  major: boolean;
  placement: "above" | "below";
}>) {
  return (
    <span
      className={`pointer-events-none w-max text-center text-[0.68rem] leading-tight ${
        placement === "above" ? "mb-1" : "mt-1"
      } ${
        major ? "opacity-100" : "opacity-0 transition-opacity group-hover:opacity-100"
      }`}
    >
      <span className="block font-mono text-muted">{date}</span>
      <span className="block font-semibold" style={{ color }}>
        {signedAmount}
      </span>
      <span className="block max-w-[8rem] truncate text-muted">{merchant}</span>
    </span>
  );
}

function isCurrentMonthLabel(label: string): boolean {
  const now = new Date();
  const currentShort = formatMonth(now.toISOString().slice(0, 7));
  const currentLong = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  return label === currentShort || label === currentLong;
}

export default function LedgerStrip({
  ticks,
  accountName,
  accountMask,
  monthLabel,
  currency,
}: Readonly<{
  ticks: LedgerTick[];
  accountName: string;
  accountMask: string | null;
  monthLabel: string;
  currency: string;
}>) {
  if (ticks.length === 0) {
    return null;
  }

  const maxAbsAmount = Math.max(...ticks.map((tick) => Math.abs(tick.amount)), 1);
  const lastTick = ticks.at(-1);
  if (!lastTick) {
    return null;
  }
  const accountLabel = accountMask ? `${accountName} •${accountMask}` : accountName;


  return (
    <Panel
      eyebrow="Running balance"
      title="Month to date, in order"
      action={<span className="eyebrow">{ticks.length} entries logged</span>}
      padding="lg"
    >
      <p className="eyebrow font-mono mb-4">
        {monthLabel} &middot; {accountLabel}
      </p>
      <div className="overflow-x-auto">
        <div
          className="relative flex min-w-[44rem] items-center"
          style={{ height: STRIP_HEIGHT }}
          data-money
        >
          {/*
            A label is `w-max` and centred on its tick, so it reaches half its
            width past the tick on each side. The widest one is the 8rem-capped
            merchant line, i.e. 64px of reach. `ml-20` (80px) keeps the tick at
            0% clear of the scroll container, and `mr-48` (192px) clears the
            `w-28` (112px) balance column by that same 64px plus margin.
          */}
          <div className="relative ml-20 mr-48 h-full flex-1">
            <div
              className="absolute inset-x-0 h-px bg-panel-border"
              style={{ top: AXIS_OFFSET }}
              aria-hidden="true"
            />
            {ticks.map((tick, index) => {
              const inflow = tick.amount > 0;
              const left = ticks.length > 1 ? (index / (ticks.length - 1)) * 100 : 50;
              const stemHeight =
                MIN_STEM_HEIGHT +
                Math.round(
                  (Math.sqrt(Math.abs(tick.amount)) / Math.sqrt(maxAbsAmount)) * STEM_RANGE,
                );
              const signedAmount = `${inflow ? "+" : "-"}${formatCurrency(
                Math.abs(tick.amount),
                currency,
              )}`;
              const detail = `${formatDate(tick.date)}: ${signedAmount}, ${tick.label}`;
              const color = inflow ? "var(--viz-pos)" : "var(--viz-neg)";
              const label = (
                <TickLabel
                  date={formatDate(tick.date)}
                  signedAmount={signedAmount}
                  merchant={tick.label}
                  color={color}
                  major={tick.major}
                  placement={inflow ? "above" : "below"}
                />
              );
              const stem = (
                <span
                  className="w-0.5 rounded-full"
                  style={{ height: `${stemHeight}px`, background: color }}
                />
              );
              return (
                <div
                  key={tick.id}
                  role="img"
                  aria-label={detail}
                  className="group absolute flex -translate-x-1/2 flex-col items-center"
                  style={
                    // Inflows hang off the axis upward, outflows downward, so each
                    // column stays anchored to the line as its stem grows.
                    inflow
                      ? { left: `${left}%`, bottom: STRIP_HEIGHT - AXIS_OFFSET }
                      : { left: `${left}%`, top: AXIS_OFFSET }
                  }
                >
                  {inflow && (
                    <>
                      {label}
                      {stem}
                    </>
                  )}
                  <span
                    className="h-2 w-2 rounded-full ring-2 ring-panel"
                    style={{ background: color }}
                  />
                  {!inflow && (
                    <>
                      {stem}
                      {label}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="absolute inset-y-0 right-0 flex w-28 flex-col justify-center border-l border-dashed border-panel-border pl-4 text-right">
            <span className="eyebrow font-mono">
              {isCurrentMonthLabel(monthLabel) ? "Today" : "Month end"}
            </span>
            <Money
              amount={lastTick.runningBalance}
              currency={currency}
              className="metric-value text-xl"
            />
          </div>
        </div>
      </div>
    </Panel>
  );
}
