import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { formatDate } from "@/lib/format-date";
import { buildLedgerDayGroups } from "@/lib/ledger-data";

vi.mock("@/components/transactions/TransactionEditor", () => ({
  default: () => React.createElement("span", { "data-testid": "editor" }),
}));

import MobileLedgerList from "@/components/transactions/MobileLedgerList";

const baseRow = {
  id: "t1",
  date: "2026-07-15",
  merchant: "Blue Bottle",
  category: "FOOD_AND_DRINK",
  accountLabel: "Checking ••1234",
  amount: 6.5,
  currency: "USD",
  pending: false,
  note: null,
  tags: [] as string[],
  splits: [] as { category: string; amount: number }[],
  categoryOptions: ["FOOD_AND_DRINK"],
};

type Row = typeof baseRow;

function render(rows: Row[], grouped = false): string {
  return renderToStaticMarkup(
    React.createElement(MobileLedgerList, {
      rows,
      dayGroups: grouped ? buildLedgerDayGroups(rows) : null,
    }),
  );
}

describe("MobileLedgerList", () => {
  it("renders merchant, formatted amount, category, and account", () => {
    const html = render([baseRow]);
    expect(html).toContain("Blue Bottle");
    expect(html).toContain("-$6.50");
    expect(html).toContain("Food And Drink");
    expect(html).toContain("Checking ••1234");
  });

  it("marks inflows with a plus sign", () => {
    expect(render([{ ...baseRow, amount: -100 }])).toContain("+$100.00");
  });

  it("colors inflows with the positive token and leaves outflows on the default color", () => {
    // Under the Plaid convention almost every row is an outflow, so painting
    // them all red made colour carry no information. Inflows are the signal.
    expect(render([{ ...baseRow, amount: -100 }])).toContain("var(--viz-pos)");
    expect(render([baseRow])).not.toContain("var(--viz-neg)");
  });

  it("sets the date in the mono face when day grouping is off", () => {
    const html = render([baseRow]);
    expect(html).toContain(`<span class="font-mono">${formatDate(baseRow.date)}</span>`);
  });

  it("zebra-stripes odd-indexed rows when day grouping is off", () => {
    const html = render([baseRow, { ...baseRow, id: "t2" }]);
    const rows = html.split("<li").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain("bg-panel-2");
    expect(rows[1]).toContain("bg-panel-2");
  });

  it("shows the pending badge only when pending", () => {
    expect(render([{ ...baseRow, pending: true }])).toContain("pending");
    expect(render([baseRow])).not.toContain("pending");
  });

  describe("with day grouping active", () => {
    const twoDays: Row[] = [
      { ...baseRow, id: "a", date: "2026-07-15", amount: 6.5 },
      { ...baseRow, id: "b", date: "2026-07-15", amount: 20 },
      { ...baseRow, id: "c", date: "2026-07-14", amount: 9 },
    ];

    it("emits one date header per day", () => {
      const html = render(twoDays, true);

      expect(html).toContain('data-ledger-day-header="2026-07-15"');
      expect(html).toContain('data-ledger-day-header="2026-07-14"');
      expect([...html.matchAll(/data-ledger-day-header=/g)]).toHaveLength(2);
    });

    it("stops repeating the date inside each card", () => {
      const html = render(twoDays, true);
      const cards = html.split("<li").filter((chunk) => chunk.includes("Blue Bottle"));

      // The group header already carries the date; printing it again on every
      // row is the redundancy grouping exists to remove.
      for (const card of cards) {
        expect(card).not.toContain(formatDate("2026-07-15"));
      }
    });

    it("prints the net for a multi-row day", () => {
      expect(render(twoDays, true)).toContain("-$26.50 net");
    });

    it("withholds the net for a single-row day", () => {
      // 2026-07-14 holds one row; a net there would restate it.
      expect(render(twoDays, true)).not.toContain("-$9.00 net");
    });

    it("restarts zebra striping inside each day group", () => {
      const html = render(twoDays, true);
      const cards = html.split("<li").filter((chunk) => chunk.includes("Blue Bottle"));

      expect(cards).toHaveLength(3);
      expect(cards[0]).not.toContain("bg-panel-2");
      expect(cards[1]).toContain("bg-panel-2");
      // New day, so the banding starts over rather than continuing.
      expect(cards[2]).not.toContain("bg-panel-2");
    });

    it("colors an inflow net with the positive token", () => {
      const html = render(
        [
          { ...baseRow, id: "a", date: "2026-07-15", amount: -100 },
          { ...baseRow, id: "b", date: "2026-07-15", amount: -50 },
        ],
        true,
      );
      expect(html).toContain("+$150.00 net");
      expect(html).toContain("var(--viz-pos)");
    });
  });
});
