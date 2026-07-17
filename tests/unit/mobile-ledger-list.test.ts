import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

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
