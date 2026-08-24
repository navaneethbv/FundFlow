import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountRow from "@/components/accounts/AccountRow";
import type { AccountsPageRow } from "@/lib/accounts-page";

function row(partial: Partial<AccountsPageRow> = {}): AccountsPageRow {
  return {
    id: "acct-1",
    ownerUserId: "user-1",
    source: "plaid",
    name: "Checking",
    type: "depository",
    subtype: "checking",
    balance: 4820.55,
    currency: "USD",
    institution: "Demo Bank",
    institutionLogo: null,
    institutionBrandColor: null,
    updatedAgo: "2 hours ago",
    stale: false,
    spark: [100, 110, 120],
    sparkLong: [100, 110, 120, 130],
    monthChange: null,
    includeInNetWorth: true,
    ...partial,
  };
}

describe("AccountRow", () => {
  it("renders the balance in the proportional money face, not mono", () => {
    const html = renderToStaticMarkup(createElement(AccountRow, { row: row() }));
    expect(html).toContain("metric-value");
    expect(html).not.toContain("font-mono");
  });

  it("marks a positive month-change with the privacy-blur hook and the positive diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(AccountRow, { row: row({ monthChange: { amount: 100, pct: 11.11 } }) }),
    );
    expect(html).toContain("data-money");
    expect(html).toContain("var(--viz-pos)");
  });

  it("colors a negative month-change with the negative diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(AccountRow, { row: row({ monthChange: { amount: -100, pct: -11.11 } }) }),
    );
    expect(html).toContain("var(--viz-neg)");
  });

  it("shows the fallback message, uncolored, when there is no month change on record", () => {
    const html = renderToStaticMarkup(createElement(AccountRow, { row: row({ monthChange: null }) }));
    expect(html).toContain("Not enough history");
  });
});