import Panel from "@/components/ui/Panel";
import Money from "@/components/ui/Money";
import DropdownButton, { type DropdownItem } from "@/components/ui/DropdownButton";
import { formatCurrency, roundsToZero } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import {
  buildLedgerStripDays,
  ledgerDaysInMonth,
  LEDGER_LABEL_WIDTH_PX,
  type LedgerDayColumn,
  type LedgerDayLabel,
  type LedgerLabelTier,
  type LedgerStripAccount,
  type LedgerTick,
} from "@/lib/ledger-strip";

/**
 * The label width, published once per strip so the label box and the rail's
 * edge inset both derive from `LEDGER_LABEL_WIDTH_PX` instead of repeating it.
 * A literal in either place could drift from the day-gap maths and clip an
 * edge label with nothing failing.
 */
const LABEL_WIDTH_VAR = "--ledger-label-width";
const LABEL_WIDTH = `var(${LABEL_WIDTH_VAR})`;
/** Half a label reaches past its tick, so that is what each rail edge reserves. */
const RAIL_EDGE_INSET = `calc(${LABEL_WIDTH} / 2)`;

/**
 * Vertical space reserved on each side of the axis line, in px. It has to fit
 * the tallest stem plus both label bands, since labels sit at fixed offsets
 * rather than in normal flow.
 */
const AXIS_OFFSET = 128;
const STRIP_HEIGHT = AXIS_OFFSET * 2;
const MIN_STEM_HEIGHT = 8;
const STEM_RANGE = 32;
const MAX_STEM_HEIGHT = MIN_STEM_HEIGHT + STEM_RANGE;
const LABEL_GAP = 6;
/** Two lines of `text-[0.68rem] leading-tight`, plus room to breathe. */
const LABEL_HEIGHT = 38;

/**
 * Distance from the axis to a label band. Band 0 sits just clear of the
 * tallest stem; band 1 stacks beyond it, so two labels close together in date
 * can still both be read.
 */
function labelOffset(band: number): number {
  return AXIS_OFFSET + MAX_STEM_HEIGHT + LABEL_GAP + band * LABEL_HEIGHT;
}

/**
 * A label is visible from its tier's breakpoint upward. The slot budget in
 * `buildLedgerStripDays` is what keeps these counts printable; this only
 * decides where each admitted label starts showing.
 */
const TIER_VISIBILITY: Record<LedgerLabelTier, string> = {
  1: "block",
  2: "hidden md:block",
  3: "hidden lg:block",
};

type DotKind = "in" | "out" | "mixed";

function dotKind(day: LedgerDayColumn): DotKind {
  if (day.grossIn > 0 && day.grossOut > 0) return "mixed";
  return day.grossIn > 0 ? "in" : "out";
}

function dotColor(kind: DotKind): string {
  switch (kind) {
    case "in":
      return "var(--viz-pos)";
    case "out":
      return "var(--viz-neg)";
    case "mixed":
      return "var(--muted)";
  }
}

function stemHeight(value: number, maxGross: number): number {
  if (value <= 0) return 0;
  return MIN_STEM_HEIGHT + Math.round((Math.sqrt(value) / Math.sqrt(maxGross)) * STEM_RANGE);
}

function isCurrentMonth(month: string): boolean {
  return month === new Date().toISOString().slice(0, 7);
}

function signedAmount(amount: number, currency: string): string {
  if (roundsToZero(amount)) return formatCurrency(0, currency);
  return `${amount > 0 ? "+" : "-"}${formatCurrency(Math.abs(amount), currency)}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Screen-reader summary for a day, carried whether or not a label is visible. */
function daySummary(day: LedgerDayColumn, currency: string): string {
  return [
    formatDate(day.date),
    day.grossIn > 0 ? `in ${formatCurrency(day.grossIn, currency)}` : null,
    day.grossOut > 0 ? `out ${formatCurrency(day.grossOut, currency)}` : null,
    plural(day.transactionCount, "transaction", "transactions"),
    `balance ${formatCurrency(day.endOfDayBalance, currency)}`,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

function TickLabel({
  label,
  side,
  currency,
}: Readonly<{
  label: LedgerDayLabel;
  side: "in" | "out";
  currency: string;
}>) {
  const color = side === "in" ? "var(--viz-pos)" : "var(--viz-neg)";
  const offset = labelOffset(label.band);
  return (
    <span
      data-label-side={side}
      data-label-tier={label.tier}
      data-label-band={label.band}
      className={`pointer-events-none absolute -translate-x-1/2 text-center text-[0.68rem] leading-tight ${TIER_VISIBILITY[label.tier]}`}
      style={{ width: LABEL_WIDTH, ...(side === "in" ? { bottom: offset } : { top: offset }) }}
      aria-hidden="true"
    >
      <span className="block font-semibold" style={{ color }} data-money>
        {signedAmount(label.amount, currency)}
      </span>
      <span className="block truncate text-muted">{label.merchant}</span>
    </span>
  );
}

/**
 * One mark per active calendar day, positioned by date.
 *
 * Both of the things that can overflow are hard-capped upstream: marks by the
 * number of days in the month, labels by an explicit slot budget. Neither
 * grows with transaction volume, which is exactly what the previous
 * per-transaction layout could not promise.
 */
export default function LedgerStrip({
  ticks,
  accountName,
  accountMask,
  month,
  monthLabel,
  currency,
  accountId,
  accounts = [],
  buildAccountHref,
}: Readonly<{
  ticks: LedgerTick[];
  accountName: string;
  accountMask: string | null;
  month: string;
  monthLabel: string;
  currency: string;
  accountId?: string;
  accounts?: LedgerStripAccount[];
  buildAccountHref?: (accountId: string | undefined) => string;
}>) {
  if (ticks.length === 0) {
    return null;
  }

  const days = buildLedgerStripDays(ticks, month);
  const lastDay = days.at(-1);
  if (!lastDay) {
    return null;
  }

  const totalDays = ledgerDaysInMonth(month);
  const maxGross = Math.max(...days.map((day) => Math.max(day.grossIn, day.grossOut)), 1);
  const entryCount = days.reduce((sum, day) => sum + day.transactionCount, 0);
  const accountLabel = accountMask ? `${accountName} •${accountMask}` : accountName;

  const hasPicker = accounts.length > 1 && Boolean(buildAccountHref);
  const accountItems: DropdownItem[] = hasPicker
    ? accounts.map((acct) => ({
        label: acct.mask ? `${acct.name ?? "Account"} •${acct.mask}` : (acct.name ?? "Account"),
        href: buildAccountHref!(acct.id === accountId ? undefined : acct.id), // clicking active item again clears back to default
        active: acct.id === accountId,
      }))
    : [];

  return (
    <Panel
      eyebrow="Account activity"
      title="Month to date, by day"
      action={
        <span className="eyebrow">
          {plural(entryCount, "entry", "entries")} &middot;{" "}
          {plural(days.length, "day", "days")}
        </span>
      }
      padding="lg"
    >
      <div className="eyebrow font-mono mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{monthLabel}</span>
        <span aria-hidden="true">&middot;</span>
        {hasPicker ? (
          <DropdownButton label={accountLabel} items={accountItems} align="left" />
        ) : (
          <span>{accountLabel}</span>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-6">
        <div
          className="relative w-full"
          style={
            {
              height: STRIP_HEIGHT,
              [LABEL_WIDTH_VAR]: `${LEDGER_LABEL_WIDTH_PX}px`,
            } as React.CSSProperties
          }
        >
          {/*
            The rail is inset by half a label width on each side so a label on
            the first or last day of the month stays inside the card without a
            scroll region.
          */}
          <div
            className="absolute inset-y-0"
            style={{ left: RAIL_EDGE_INSET, right: RAIL_EDGE_INSET }}
          >
            <div
              className="absolute inset-x-0 h-px bg-panel-border"
              style={{ top: AXIS_OFFSET }}
              aria-hidden="true"
            />
            {days.map((day) => {
              const left = ((day.dayOfMonth - 1) / (totalDays - 1)) * 100;
              const inHeight = stemHeight(day.grossIn, maxGross);
              const outHeight = stemHeight(day.grossOut, maxGross);
              // A day carrying both directions gets a neutral dot, because
              // picking either colour would claim a direction it does not have.
              const dot = dotKind(day);
              const color = dotColor(dot);

              return (
                <div
                  key={day.date}
                  data-ledger-day={day.date}
                  role="img"
                  aria-label={daySummary(day, currency)}
                  className="absolute inset-y-0"
                  style={{ left: `${left.toFixed(4)}%` }}
                >
                  {day.inflowLabel && (
                    <TickLabel label={day.inflowLabel} side="in" currency={currency} />
                  )}
                  {inHeight > 0 && (
                    <span
                      className="absolute w-0.5 -translate-x-1/2 rounded-full"
                      style={{
                        bottom: STRIP_HEIGHT - AXIS_OFFSET,
                        height: inHeight,
                        background: "var(--viz-pos)",
                      }}
                    />
                  )}
                  <span
                    data-dot={dot}
                    className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel"
                    style={{ top: AXIS_OFFSET, background: color }}
                  />
                  {outHeight > 0 && (
                    <span
                      className="absolute w-0.5 -translate-x-1/2 rounded-full"
                      style={{
                        top: AXIS_OFFSET,
                        height: outHeight,
                        background: "var(--viz-neg)",
                      }}
                    />
                  )}
                  {day.outflowLabel && (
                    <TickLabel label={day.outflowLabel} side="out" currency={currency} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-dashed border-panel-border pt-3 lg:w-28 lg:flex-col lg:items-end lg:justify-center lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4 lg:text-right">
          <span className="eyebrow font-mono">
            {isCurrentMonth(month) ? "Today" : "Month end"}
          </span>
          <Money
            amount={lastDay.endOfDayBalance}
            currency={currency}
            className="metric-value text-xl"
          />
        </div>
      </div>
    </Panel>
  );
}
