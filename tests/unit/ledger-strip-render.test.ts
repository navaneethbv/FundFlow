import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LedgerStrip from "@/components/dashboard/LedgerStrip";
import type { LedgerTick } from "@/lib/ledger-strip";

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
  monthLabel: "August 2026",
  currency: "USD",
};

describe("LedgerStrip", () => {
  it("renders nothing when there are no ticks", () => {
    const html = renderToStaticMarkup(createElement(LedgerStrip, { ...baseProps, ticks: [] }));
    expect(html).toBe("");
  });

  it("shows the account name, mask, and month label", () => {
    const html = renderToStaticMarkup(createElement(LedgerStrip, baseProps));
    expect(html).toContain("Demo Checking");
    expect(html).toContain("0001");
    expect(html).toContain("August 2026");
  });

  it("shows the entry count", () => {
    const html = renderToStaticMarkup(
      createElement(LedgerStrip, {
        ...baseProps,
        ticks: [tick({ id: "1" }), tick({ id: "2" })],
      }),
    );
    expect(html).toContain("2 entries logged");
  });

  it("carries the running balance on the closing figure via the money hook", () => {
    const html = renderToStaticMarkup(createElement(LedgerStrip, baseProps));
    expect(html).toContain("money");
    expect(html).toContain("$3,170.55");
  });

  it("keeps a major tick's label always visible", () => {
    const html = renderToStaticMarkup(
      createElement(LedgerStrip, { ...baseProps, ticks: [tick({ major: true })] }),
    );
    expect(html).not.toContain("opacity-0");
  });

  it("reveals a minor tick's label only on hover/focus", () => {
    const html = renderToStaticMarkup(
      createElement(LedgerStrip, {
        ...baseProps,
        ticks: [tick({ major: false, amount: -6.75 })],
      }),
    );
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover:opacity-100");
  });

  it("colors an inflow tick with the positive diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(LedgerStrip, {
        ...baseProps,
        ticks: [tick({ amount: 2450, major: true })],
      }),
    );
    expect(html).toContain("var(--viz-pos)");
  });

  it("colors an outflow tick with the negative diverging token", () => {
    const html = renderToStaticMarkup(createElement(LedgerStrip, baseProps));
    expect(html).toContain("var(--viz-neg)");
  });
});
