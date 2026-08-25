import Panel from "@/components/ui/Panel";
import Money from "@/components/ui/Money";
import { formatCurrency, formatMonth } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import type { LedgerTick } from "@/lib/ledger-strip";

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
        <div className="relative flex h-32 min-w-[44rem] items-center" data-money>
          <div className="relative mr-36 mx-8 h-full flex-1">
            <div className="absolute inset-x-0 top-14 h-px bg-panel-border" aria-hidden="true" />
            {ticks.map((tick, index) => {
              const inflow = tick.amount > 0;
              const left = ticks.length > 1 ? (index / (ticks.length - 1)) * 100 : 50;
              const stemHeight =
                8 +
                Math.round((Math.sqrt(Math.abs(tick.amount)) / Math.sqrt(maxAbsAmount)) * 40);
              const signedAmount = `${inflow ? "+" : "-"}${formatCurrency(
                Math.abs(tick.amount),
                currency,
              )}`;
              const detail = `${formatDate(tick.date)}: ${signedAmount}, ${tick.label}`;
              return (
                <div
                  key={tick.id}
                  role="img"
                  aria-label={detail}
                  className={`group absolute flex -translate-x-1/2 flex-col items-center ${
                    inflow ? "bottom-[calc(100%-56px)]" : "top-14"
                  }`}
                  style={{ left: `${left}%` }}
                >
                  {inflow && (
                    <>
                      <span
                        className={`pointer-events-none mb-1 w-max text-center text-[0.68rem] ${
                          tick.major
                            ? "opacity-100"
                            : "opacity-0 transition-opacity group-hover:opacity-100"
                        }`}
                      >
                        <span className="block font-mono text-muted">{formatDate(tick.date)}</span>
                        <span className="block font-semibold" style={{ color: "var(--viz-pos)" }}>
                          {signedAmount}
                        </span>
                        <span className="block max-w-[8rem] truncate text-muted">{tick.label}</span>
                      </span>
                      <span
                        className="w-0.5 rounded-full"
                        style={{
                          height: `${stemHeight}px`,
                          background: "var(--viz-pos)",
                        }}
                      />
                    </>
                  )}
                  <span
                    className="h-2 w-2 rounded-full ring-2 ring-panel"
                    style={{ background: inflow ? "var(--viz-pos)" : "var(--viz-neg)" }}
                  />
                  {!inflow && (
                    <>
                      <span
                        className="w-0.5 rounded-full"
                        style={{
                          height: `${stemHeight}px`,
                          background: "var(--viz-neg)",
                        }}
                      />
                      <span
                        className={`pointer-events-none mt-1 w-max text-center text-[0.68rem] ${
                          tick.major
                            ? "opacity-100"
                            : "opacity-0 transition-opacity group-hover:opacity-100"
                        }`}
                      >
                        <span className="block font-mono text-muted">{formatDate(tick.date)}</span>
                        <span className="block font-semibold" style={{ color: "var(--viz-neg)" }}>
                          {signedAmount}
                        </span>
                        <span className="block max-w-[8rem] truncate text-muted">{tick.label}</span>
                      </span>
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
