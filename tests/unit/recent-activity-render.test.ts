import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RecentActivity, {
  type RecentTransaction,
} from "@/components/dashboard/RecentActivity";

function transaction(partial: Partial<RecentTransaction> = {}): RecentTransaction {
  return {
    id: "1",
    date: "2026-08-23",
    amount: 64.18,
    iso_currency_code: "USD",
    merchant_name: "Corner Grocer",
    name: null,
    pfc_primary: "FOOD_AND_DRINK",
    account_id: "acct-1",
    ...partial,
  };
}

describe("RecentActivity", () => {
  it("renders a message when there are no transactions", () => {
    const html = renderToStaticMarkup(
      createElement(RecentActivity, { transactions: [], accountNames: new Map() }),
    );
    expect(html).toContain("No recent activity yet.");
  });

  it("zebra-stripes every other row via RegisterRow", () => {
    const html = renderToStaticMarkup(
      createElement(RecentActivity, {
        transactions: [
          transaction({ id: "1" }),
          transaction({ id: "2" }),
          transaction({ id: "3" }),
        ],
        accountNames: new Map(),
      }),
    );
    const rows = html.split("<li").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).not.toContain("bg-panel-2");
    expect(rows[1]).toContain("bg-panel-2");
    expect(rows[2]).not.toContain("bg-panel-2");
  });

  it("converts the Plaid-signed amount to RegisterRow's display sign convention", () => {
    // amount: 64.18 (Plaid: money out) must render as an outflow, "-$64.18".
    const html = renderToStaticMarkup(
      createElement(RecentActivity, {
        transactions: [transaction({ amount: 64.18 })],
        accountNames: new Map(),
      }),
    );
    expect(html).toContain("-$64.18");
    expect(html).toContain("var(--viz-neg)");
  });

  it("renders a Plaid negative amount (money in) as an inflow", () => {
    const html = renderToStaticMarkup(
      createElement(RecentActivity, {
        transactions: [transaction({ amount: -2450, merchant_name: "Acme Payroll" })],
        accountNames: new Map(),
      }),
    );
    expect(html).toContain("+$2,450.00");
    expect(html).toContain("var(--viz-pos)");
  });

  it("includes the category and account name in the meta line", () => {
    const html = renderToStaticMarkup(
      createElement(RecentActivity, {
        transactions: [transaction({ account_id: "acct-1" })],
        accountNames: new Map([["acct-1", "Demo Checking **0001"]]),
      }),
    );
    expect(html).toContain("Food And Drink");
    expect(html).toContain("Demo Checking");
  });
});