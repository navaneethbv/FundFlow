import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReportTransactions, { REPORT_PAGE_SIZE } from "@/components/reports/ReportTransactions";
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

function render(transactions: CanonicalFinanceTransaction[], page = 1): string {
  return renderToStaticMarkup(
    createElement(ReportTransactions, { ...baseProps, page, transactions }),
  );
}

describe("ReportTransactions", () => {
  it("formats the date through the app's date formatter, in the mono face", () => {
    const html = render([row({ date: "2026-08-23" })]);
    expect(html).toContain(formatDate("2026-08-23"));
    expect(html).toContain("font-mono");
  });

  it("humanizes the category instead of printing the raw enum", () => {
    const html = render([row({ categoryKey: "RENT_AND_UTILITIES" })]);
    expect(html).toContain("Rent And Utilities");
    expect(html).not.toContain("RENT_AND_UTILITIES");
  });

  it("falls back to Unknown for an empty category", () => {
    expect(render([row({ categoryKey: "" })])).toContain("Unknown");
  });

  it("colors an income row with the positive diverging token", () => {
    expect(render([row({ flow: "income", signedAmount: -2450 })])).toContain("var(--viz-pos)");
  });

  it("leaves an ordinary expense on the default color", () => {
    // Nearly every report row is an expense, so colouring them all made the
    // amount column a uniform block that carried no information.
    expect(render([row({ flow: "expense" })])).not.toContain("var(--viz-neg)");
  });

  it("leaves a transfer row neutral", () => {
    const html = render([row({ flow: "transfer" })]);
    expect(html).not.toContain("var(--viz-pos)");
    expect(html).not.toContain("var(--viz-neg)");
  });

  it("signs the amount and keeps direction available to assistive technology", () => {
    const outgoing = render([row({ flow: "expense", signedAmount: 64.18 })]);
    expect(outgoing).toContain("-$64.18");
    // Sign alone must not be the only cue.
    expect(outgoing).toContain("sr-only");
    expect(outgoing).toContain("Out");

    const incoming = render([row({ flow: "income", signedAmount: -2450 })]);
    expect(incoming).toContain("+$2,450.00");
    expect(incoming).toContain("In");
  });

  it.each([
    ["exact zero", 0],
    ["negative zero", -0],
    ["rounds to zero", 0.004],
    ["negative rounds to zero", -0.004],
  ] as const)("renders an income-row %s as neutral $0.00 with no direction label", (_name, amount) => {
    // flow "income" is the worst case: before the fix it would have painted
    // $0.00 In in positive green.
    const html = render([row({ flow: "income", signedAmount: amount })]);
    expect(html).toContain("$0.00");
    expect(html).not.toContain("-$0.00");
    expect(html).not.toContain("+$0.00");
    expect(html).not.toContain("var(--viz-pos)");
    // No hidden "In" / "Out" accessible cue for a zero.
    const amountCell = html.slice(html.indexOf("data-money"));
    expect(amountCell).not.toContain("> In<");
    expect(amountCell).not.toContain("> Out<");
    expect(amountCell).not.toContain("sr-only");
  });

  it.each([
    ["0.005 stays a positive cent", 0.005, "-$0.01"],
    ["-0.005 stays a negative cent", -0.005, "+$0.01"],
  ] as const)("%s", (_name, amount, expected) => {
    expect(render([row({ flow: "expense", signedAmount: amount })])).toContain(expected);
  });

  it("renders a zero day net neutrally", () => {
    const html = render([
      row({ id: "a", date: "2026-08-23", signedAmount: 5 }),
      row({ id: "b", date: "2026-08-23", signedAmount: -5 }),
    ]);
    expect(html).toContain("$0.00 net");
    expect(html).not.toContain("+$0.00 net");
    expect(html).not.toContain("-$0.00 net");
    expect(html).not.toContain("var(--viz-pos)");
  });

  it("drops the standalone Direction column", () => {
    expect(render([row()])).not.toContain(">Direction<");
  });

  it("anchors the visually-hidden direction text to its own cell", () => {
    // `sr-only` is absolutely positioned. Without a positioned ancestor it
    // resolves against the initial containing block, and in this wide table
    // that static position lands past the viewport edge and makes the whole
    // page scroll sideways on a phone.
    const html = render([row()]);
    const amountCell = html.slice(html.indexOf("data-money"));
    expect(amountCell).toContain("relative");
  });

  it("keeps the amount inside the privacy-blur hook", () => {
    expect(render([row()])).toContain("data-money");
  });

  describe("day grouping", () => {
    const sameDay = [
      row({ id: "a", date: "2026-08-23", signedAmount: 10 }),
      row({ id: "b", date: "2026-08-23", signedAmount: 20 }),
      row({ id: "c", date: "2026-08-22", signedAmount: 45 }),
    ];

    it("emits one date header per day", () => {
      const html = render(sameDay);
      expect(html).toContain('data-ledger-day-header="2026-08-23"');
      expect(html).toContain('data-ledger-day-header="2026-08-22"');
      expect([...html.matchAll(/data-ledger-day-header=/g)]).toHaveLength(2);
    });

    it("prints the net for a multi-row day", () => {
      expect(render(sameDay)).toContain("-$30.00 net");
    });

    it("withholds the net for a single-row day", () => {
      // 2026-08-22 holds one row, so a net there would restate the amount
      // directly below it.
      expect(render(sameDay)).not.toContain("-$45.00 net");
    });

    it("restarts zebra striping inside each day group", () => {
      const html = render(sameDay);
      const dataRows = html.split("<tr").filter((chunk) => chunk.includes("Corner Grocer"));
      expect(dataRows).toHaveLength(3);
      expect(dataRows[0]).not.toContain("bg-panel-2");
      expect(dataRows[1]).toContain("bg-panel-2");
      expect(dataRows[2]).not.toContain("bg-panel-2");
    });

    it("withholds the net when a day is split across the report page boundary", () => {
      const filler = Array.from({ length: REPORT_PAGE_SIZE - 1 }, (_, i) =>
        row({ id: `f${i}`, date: "2026-08-30", signedAmount: 1 }),
      );
      const straddling = [
        row({ id: "s1", date: "2026-08-10", signedAmount: 100 }),
        row({ id: "s2", date: "2026-08-10", signedAmount: 200 }),
      ];
      const html = render([...filler, ...straddling]);

      // s1 ends page one and s2 begins page two, so a page-local sum labelled
      // as the daily total would be wrong.
      expect(html).toContain('data-ledger-day-header="2026-08-10"');
      expect(html).not.toContain("-$100.00 net");
    });
  });

  describe("non-date sort order", () => {
    const rows = [
      row({ id: "a", date: "2026-08-22", signedAmount: 10 }),
      row({ id: "b", date: "2026-08-23", signedAmount: 20 }),
      row({ id: "c", date: "2026-08-23", signedAmount: 30 }),
    ];

    function renderUngrouped(transactions: typeof rows): string {
      return renderToStaticMarkup(
        createElement(ReportTransactions, {
          ...baseProps,
          transactions,
          groupByDate: false,
        }),
      );
    }

    it("renders no day headers for merchant or amount sorts", () => {
      const html = renderUngrouped(rows);
      expect(html).not.toContain('data-ledger-day-header=');
      expect(html).not.toContain(" net");
      expect(html).toContain("Transactions matching the current report filters.");
      expect(html).not.toContain("grouped by day");
    });

    it("still zebra-stripes every row in a non-chronological order", () => {
      const html = renderUngrouped(rows);
      const dataRows = html.split("<tr").filter((chunk) => chunk.includes("Corner Grocer"));
      expect(dataRows).toHaveLength(3);
      expect(dataRows[1]).toContain("bg-panel-2");
    });

    it("keeps date grouping on by default for the date sort", () => {
      const html = renderToStaticMarkup(
        createElement(ReportTransactions, {
          ...baseProps,
          transactions: rows,
        }),
      );
      expect(html).toContain('data-ledger-day-header=');
    });
  });
});
