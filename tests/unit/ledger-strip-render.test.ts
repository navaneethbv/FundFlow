import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LedgerStrip from "@/components/dashboard/LedgerStrip";
import {
  LEDGER_LABEL_SLOT_BUDGETS,
  LEDGER_LABEL_WIDTH_PX,
  type LedgerTick,
} from "@/lib/ledger-strip";

function tick(partial: Partial<LedgerTick> = {}): LedgerTick {
  return {
    id: "1",
    date: "2026-08-01",
    label: "Maple St. Apartments",
    amount: -1650,
    runningBalance: 3170.55,
    major: true,
    ...partial,
  };
}

const baseProps = {
  ticks: [tick()],
  accountName: "Demo Checking",
  accountMask: "0001",
  month: "2026-08",
  monthLabel: "August 2026",
  currency: "USD",
};

function render(props: Partial<typeof baseProps> = {}): string {
  return renderToStaticMarkup(createElement(LedgerStrip, { ...baseProps, ...props }));
}

const dayColumnCount = (html: string) => [...html.matchAll(/data-ledger-day="/g)].length;

const labelsUpToTier = (html: string, tier: number) =>
  [...html.matchAll(/data-label-tier="(\d)"/g)].filter((match) => Number(match[1]) <= tier)
    .length;

/** `count` outflow ticks spread deterministically across August 2026. */
function spreadTicks(count: number): LedgerTick[] {
  return Array.from({ length: count }, (_, index) =>
    tick({
      id: `t${index}`,
      date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
      amount: -(10 + index),
      label: `Merchant ${index}`,
    }),
  );
}

describe("LedgerStrip", () => {
  it("renders nothing when there are no ticks", () => {
    expect(render({ ticks: [] })).toBe("");
  });

  it("shows the account name, mask, and month label", () => {
    const html = render();
    expect(html).toContain("Demo Checking");
    expect(html).toContain("0001");
    expect(html).toContain("August 2026");
  });

  it("reports both the source entry count and the active-day count", () => {
    const html = render({
      ticks: [
        tick({ id: "1", date: "2026-08-03" }),
        tick({ id: "2", date: "2026-08-03" }),
        tick({ id: "3", date: "2026-08-09" }),
      ],
    });
    // Aggregation has to be explicit, or two marks for three entries reads as
    // missing data.
    expect(html).toContain("3 entries");
    expect(html).toContain("2 days");
  });

  it("collapses ten same-day ticks into a single day column", () => {
    const ticks = Array.from({ length: 10 }, (_, index) =>
      tick({ id: `t${index}`, date: "2026-08-15", amount: -(index + 1) }),
    );

    const html = render({ ticks });

    expect(dayColumnCount(html)).toBe(1);
    expect(html).toContain('data-ledger-day="2026-08-15"');
  });

  it("never renders more day columns than the month has calendar days", () => {
    for (const count of [40, 150]) {
      const html = render({ ticks: spreadTicks(count) });
      expect(dayColumnCount(html), `${count} ticks`).toBeLessThanOrEqual(31);
    }
  });

  it("keeps visible label slots inside the per-tier budget at volume", () => {
    const html = render({ ticks: spreadTicks(150) });

    expect(labelsUpToTier(html, 1)).toBeLessThanOrEqual(LEDGER_LABEL_SLOT_BUDGETS[1]);
    expect(labelsUpToTier(html, 2)).toBeLessThanOrEqual(LEDGER_LABEL_SLOT_BUDGETS[2]);
    expect(labelsUpToTier(html, 3)).toBeLessThanOrEqual(LEDGER_LABEL_SLOT_BUDGETS[3]);
  });

  it("positions a day column by its date rather than its index", () => {
    const html = render({
      ticks: [
        tick({ id: "a", date: "2026-08-01" }),
        tick({ id: "b", date: "2026-08-02" }),
        tick({ id: "c", date: "2026-08-31" }),
      ],
    });

    // Day 2 of 31 sits at 1/30 of the rail. Ordinal spacing would put the
    // middle mark at the halfway point and misrepresent the month.
    expect(html).toContain("left:3.3333%");
    expect(html).not.toContain("left:50%");
  });

  it("derives the label box and the rail inset from one exported constant", () => {
    const html = render();

    // The rail reserves half a label at each edge so a label centred on the
    // first or last day cannot overflow. Repeating the number instead of
    // deriving it is what would let the two drift apart and clip silently, so
    // the contract is that both read the same custom property.
    expect(html).toContain(`--ledger-label-width:${LEDGER_LABEL_WIDTH_PX}px`);
    expect(html).toContain("width:var(--ledger-label-width)");
    expect(html).toContain("calc(var(--ledger-label-width) / 2)");
    expect(html).not.toMatch(/w-\[\d+px\]/);
    expect(html).not.toMatch(/\b(left|right)-9\b/);
  });

  it("does not rely on a minimum-width rail or an internal horizontal scroll region", () => {
    const html = render({ ticks: spreadTicks(40) });

    expect(html).not.toContain("min-w-[44rem]");
    expect(html).not.toContain("overflow-x-auto");
  });

  it("draws both stems and a neutral dot on a day carrying inflow and outflow", () => {
    const html = render({
      ticks: [
        tick({ id: "in", date: "2026-08-05", amount: 2450, label: "Acme Payroll" }),
        tick({ id: "out", date: "2026-08-05", amount: -1650, label: "Maple St" }),
      ],
    });

    expect(html).toContain("var(--viz-pos)");
    expect(html).toContain("var(--viz-neg)");
    // A one-directional dot on a mixed day would claim a direction the day
    // does not have.
    expect(html).toContain('data-dot="mixed"');
  });

  it("defers tier 2 labels to md and tier 3 labels to lg", () => {
    const html = render({ ticks: spreadTicks(150) });

    expect(html).toContain('data-label-tier="1"');
    expect(html).toContain('data-label-tier="2"');
    expect(html).toContain("md:block");
    expect(html).toContain("lg:block");
  });

  it("tags every label with its side and band so collisions stay checkable", () => {
    const html = render({ ticks: spreadTicks(40) });

    expect(html).toContain('data-label-side="out"');
    expect(html).toMatch(/data-label-band="[01]"/);
  });

  it("titles the panel as activity rather than promising a balance trajectory", () => {
    const html = render();

    // The vertical dimension encodes per-day amounts, not the balance over
    // time, so the old "Running balance" title over-promised.
    expect(html).not.toContain("Running balance");
    expect(html).toContain("Account activity");
  });

  it("carries the closing balance on the money hook", () => {
    const html = render();
    expect(html).toContain("money");
    expect(html).toContain("$3,170.55");
  });

  it("takes the closing figure from the final day column", () => {
    const html = render({
      ticks: [
        tick({ id: "a", date: "2026-08-01", runningBalance: 100 }),
        tick({ id: "b", date: "2026-08-20", runningBalance: 4820.55 }),
      ],
    });
    expect(html).toContain("$4,820.55");
  });

  it("colors an inflow with the positive diverging token", () => {
    expect(render({ ticks: [tick({ amount: 2450 })] })).toContain("var(--viz-pos)");
  });

  it("colors an outflow with the negative diverging token", () => {
    expect(render()).toContain("var(--viz-neg)");
  });

  it("displays 'Today' when month is the current calendar month", () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const html = render({
      month: currentMonth,
      ticks: [tick({ date: `${currentMonth}-01` })],
    });
    expect(html).toContain("Today");
    expect(html).not.toContain("Month end");
  });

  it("displays 'Month end' when month is a historical month", () => {
    const html = render({
      month: "2020-01",
      monthLabel: "January 2020",
      ticks: [tick({ date: "2020-01-05" })],
    });
    expect(html).toContain("Month end");
    expect(html).not.toContain("Today");
  });

  it("renders nothing when every tick falls outside the month", () => {
    expect(render({ ticks: [tick({ date: "2026-07-14" })] })).toBe("");
  });
});
