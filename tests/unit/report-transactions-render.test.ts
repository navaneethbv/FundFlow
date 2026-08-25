import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReportTransactions from "@/components/reports/ReportTransactions";
import { formatDate } from "@/lib/format-date";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

function row(partial: Partial<CanonicalFinanceTransaction> = {}): CanonicalFinanceTransaction {
  return {
    id: "1",
    sourceTransactionId: "txn-1",
    date: "2026-08-23",
    signedAmount: 64.18,
    flow: "expense",
    merchant: "Corner Grocer",
    groupKey: "FOOD_AND_DRINK",
    categoryKey: "FOOD_AND_DRINK",
    accountId: "acct-1",
    manualAccountId: null,
    pending: false,
    source: "plaid",
    ...partial,
  } as CanonicalFinanceTransaction;
}

const baseProps = {
  currency: "USD",
  page: 1,
  hrefForPage: (page: number) => `/reports?page=${page}`,
};

describe("ReportTransactions", () => {
  it("formats the date through the app's date formatter, in the mono face", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, {
        ...baseProps,
        transactions: [row({ date: "2026-08-23" })],
      }),
    );
    expect(html).toContain(
      `<td class="py-2 pr-3 whitespace-nowrap font-mono">${formatDate("2026-08-23")}</td>`,
    );
    expect(html).not.toContain(">2026-08-23<");
  });

  it("zebra-stripes odd-indexed data rows and not even-indexed ones", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, {
        ...baseProps,
        transactions: [row({ id: "1" }), row({ id: "2" })],
      }),
    );
    // rows[0] is the <thead> row; data rows follow.
    const rows = html.split("<tr").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[1]).not.toContain("bg-panel-2");
    expect(rows[2]).toContain("bg-panel-2");
  });

  it("colors an income row with the positive diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, {
        ...baseProps,
        transactions: [row({ flow: "income", signedAmount: -2450 })],
      }),
    );
    expect(html).toContain("var(--viz-pos)");
  });

  it("colors an expense row with the negative diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, {
        ...baseProps,
        transactions: [row({ flow: "expense", signedAmount: 64.18 })],
      }),
    );
    expect(html).toContain("var(--viz-neg)");
  });

  it("leaves a transfer row neutral (no diverging color token applied)", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, {
        ...baseProps,
        transactions: [row({ flow: "transfer", signedAmount: 100 })],
      }),
    );
    expect(html).not.toContain("var(--viz-pos)");
    expect(html).not.toContain("var(--viz-neg)");
    expect(html).toContain(">Transfer<");
  });

  it("still shows the absolute amount with no sign prefix; direction stays conveyed by the Direction column", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, {
        ...baseProps,
        transactions: [row({ flow: "income", signedAmount: -2450 })],
      }),
    );
    expect(html).toContain("$2,450.00");
    expect(html).toContain(">In<");
  });

  it("keeps the amount inside the privacy-blur hook", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, { ...baseProps, transactions: [row()] }),
    );
    expect(html).toContain("data-money");
  });

  it("mono-izes the column header row", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, { ...baseProps, transactions: [row()] }),
    );
    expect(html).toContain('<tr class="text-left opacity-60 font-mono">');
  });
});