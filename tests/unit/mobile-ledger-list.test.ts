import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { formatDate } from "@/lib/format-date";

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

describe("MobileLedgerList", () => {
  it("renders merchant, formatted amount, category, and account", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileLedgerList, { rows: [baseRow] }),
    );
    expect(html).toContain("Blue Bottle");
    expect(html).toContain("-$6.50");
    expect(html).toContain("Food And Drink");
    expect(html).toContain("Checking ••1234");
  });

  it("marks inflows with a plus sign", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileLedgerList, {
        rows: [{ ...baseRow, amount: -100 }],
      }),
    );
    expect(html).toContain("+$100.00");
  });

  it("colors an inflow with the positive diverging token and an outflow with the negative one", () => {
    const credit = renderToStaticMarkup(
      React.createElement(MobileLedgerList, { rows: [{ ...baseRow, amount: -100 }] }),
    );
    expect(credit).toContain("var(--viz-pos)");

    const debit = renderToStaticMarkup(
      React.createElement(MobileLedgerList, { rows: [baseRow] }),
    );
    expect(debit).toContain("var(--viz-neg)");
  });

  it("sets the date in the mono face", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileLedgerList, { rows: [baseRow] }),
    );
    expect(html).toContain(`<span class="font-mono">${formatDate(baseRow.date)}</span>`);
  });

  it("zebra-stripes odd-indexed rows and not even-indexed rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileLedgerList, {
        rows: [baseRow, { ...baseRow, id: "t2" }],
      }),
    );
    const rows = html.split("<li").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain("bg-panel-2");
    expect(rows[1]).toContain("bg-panel-2");
  });

  it("shows the pending badge only when pending", () => {
    const pendingHtml = renderToStaticMarkup(
      React.createElement(MobileLedgerList, {
        rows: [{ ...baseRow, pending: true }],
      }),
    );
    expect(pendingHtml).toContain("pending");
    const settledHtml = renderToStaticMarkup(
      React.createElement(MobileLedgerList, { rows: [baseRow] }),
    );
    expect(settledHtml).not.toContain("pending");
  });
});