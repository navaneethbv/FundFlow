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

  it("zebra-stripes every other row", () => {
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

  it("sets the date in the mono face", () => {
    const html = renderToStaticMarkup(
      createElement(RecentActivity, {
        transactions: [transaction()],
        accountNames: new Map(),
      }),
    );
    expect(html).toContain('class="block text-xs text-muted font-mono"');
  });
});
