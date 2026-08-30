import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  HoldingRow,
  InvestmentAccountCoverage,
  InvestmentsPage,
} from "@/lib/investments";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import HoldingsTable from "@/components/investments/HoldingsTable";
import TopMovers from "@/components/investments/TopMovers";
import PerformanceChart from "@/components/investments/PerformanceChart";
import AddManualHoldingForm from "@/components/investments/AddManualHoldingForm";
import ConnectedAccounts from "@/components/investments/ConnectedAccounts";

function holding(overrides: Partial<HoldingRow> = {}): HoldingRow {
  return {
    id: "holding-1",
    accountId: "account-1",
    manualAccountId: null,
    accountName: "Brokerage",
    securityName: "Vanguard Total Stock",
    ticker: "VTI",
    securityType: "etf",
    quantity: 10,
    price: 250,
    value: 2500,
    source: "plaid",
    isActive: true,
    weightPct: 100,
    periodChangePct: 1.5,
    ...overrides,
  };
}

function page(overrides: Partial<InvestmentsPage> = {}): InvestmentsPage {
  return {
    total: 2500,
    dayChange: { amount: 25, pct: 1 },
    byClass: [{ label: "Funds", holdings: [holding()], subtotal: 2500 }],
    topMovers: null,
    balanceHistory: [],
    ...overrides,
  };
}

describe("HoldingsTable", () => {
  it("shows a security avatar, ticker, and a grand Total row summing every group", () => {
    const html = renderToStaticMarkup(
      createElement(HoldingsTable, { page: page(), currency: "USD" }),
    );
    expect(html).toContain("Vanguard Total Stock");
    expect(html).toContain("VTI");
    expect(html).toContain("Total");
    expect(html).toContain("$2,500.00");
  });

  it("colors a positive change with the positive diverging token, a negative one with the negative token", () => {
    const positive = renderToStaticMarkup(
      createElement(HoldingsTable, {
        page: page({ byClass: [{ label: "Funds", holdings: [holding({ periodChangePct: 2 })], subtotal: 2500 }] }),
        currency: "USD",
      }),
    );
    expect(positive).toContain("var(--viz-pos)");

    const negative = renderToStaticMarkup(
      createElement(HoldingsTable, {
        page: page({ byClass: [{ label: "Funds", holdings: [holding({ periodChangePct: -2 })], subtotal: 2500 }] }),
        currency: "USD",
      }),
    );
    expect(negative).toContain("var(--viz-neg)");
    expect(negative).not.toContain("text-success");
    expect(negative).not.toContain("text-danger");
  });

  it("marks the group subtotal row with the privacy-blur hook, alongside the per-holding value", () => {
    // The per-holding value/change cells and the Total row already carry
    // data-money; the group-subtotal row does not (the gap this task closes).
    // With one holding in one group the fix brings the count to 4.
    const html = renderToStaticMarkup(
      createElement(HoldingsTable, { page: page(), currency: "USD" }),
    );
    expect(html.match(/data-money/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("has an empty state when there are no holdings", () => {
    const html = renderToStaticMarkup(
      createElement(HoldingsTable, { page: page({ byClass: [] }), currency: "USD" }),
    );
    expect(html).toContain("No holdings yet");
  });
});

describe("TopMovers", () => {
  it("colors gains with the positive diverging token and losses with the negative one", () => {
    const html = renderToStaticMarkup(
      createElement(TopMovers, {
        movers: [
          { id: "up", name: "Up Co", ticker: "UP", changePct: 3.2 },
          { id: "dn", name: "Down Co", ticker: "DN", changePct: -1.1 },
        ],
      }),
    );
    expect(html).toContain("var(--viz-pos)");
    expect(html).toContain("var(--viz-neg)");
    expect(html).not.toContain("text-success");
    expect(html).not.toContain("text-danger");
  });

  it("zebra-stripes odd-indexed rows and not even-indexed ones", () => {
    const html = renderToStaticMarkup(
      createElement(TopMovers, {
        movers: [
          { id: "a", name: "A Co", ticker: "A", changePct: 1 },
          { id: "b", name: "B Co", ticker: "B", changePct: -1 },
        ],
      }),
    );
    const rows = html.split("<li").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain("bg-panel-2");
    expect(rows[1]).toContain("bg-panel-2");
  });
});

describe("PerformanceChart", () => {
  it("colors a positive time-weighted return with the positive diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(PerformanceChart, {
        balanceHistory: [
          { date: "2026-06-01", value: 1000 },
          { date: "2026-07-01", value: 1100 },
        ],
        returns: [
          { date: "2026-06-01", pct: 0 },
          { date: "2026-07-01", pct: 5 },
        ],
        currency: "USD",
      }),
    );
    expect(html).toContain("var(--viz-pos)");
    expect(html).not.toContain("text-success");
  });

  it("carries the performance figure inside the privacy-blur hook", () => {
    const html = renderToStaticMarkup(
      createElement(PerformanceChart, {
        balanceHistory: [
          { date: "2026-06-01", value: 1000 },
          { date: "2026-07-01", value: 1100 },
        ],
        returns: [
          { date: "2026-06-01", pct: 0 },
          { date: "2026-07-01", pct: 5 },
        ],
        currency: "USD",
      }),
    );
    expect(html).toContain("data-money");
  });

  it("exposes stable ISO dates in the accessible history table", () => {
    const html = renderToStaticMarkup(
      createElement(PerformanceChart, {
        balanceHistory: [
          { date: "2026-08-08", value: 1000 },
          { date: "2026-08-09", value: 1042 },
        ],
        returns: [
          { date: "2026-08-08", pct: 0 },
          { date: "2026-08-09", pct: 4.2 },
        ],
        currency: "USD",
      }),
    );
    expect(html).toContain('<time dateTime="2026-08-09">2026-08-09</time>');
  });
});

describe("AddManualHoldingForm — closed trigger and modal shell", () => {
  it("renders the Add Holding trigger button", () => {
    const html = renderToStaticMarkup(
      createElement(AddManualHoldingForm, { accounts: [] }),
    );
    expect(html).toContain("Add Holding");
    expect(html).not.toContain('role="dialog"');
  });

  it("is the standard app modal recipe, not an inline expanding form", () => {
    const source = readFileSync("components/investments/AddManualHoldingForm.tsx", "utf8");
    expect(source).toContain("fixed inset-0 z-50");
    expect(source).toContain("<dialog");
    expect(source).toContain("bg-black/50");
  });
});

describe("ConnectedAccounts", () => {
  it("renders the selected value source and uses mixed-coverage copy", () => {
    const coverage: InvestmentAccountCoverage = {
      total: 4200,
      accountsWithoutHoldings: 1,
      accounts: [
        {
          id: "with-holdings",
          name: "Brokerage",
          source: "plaid",
          type: "investment",
          subtype: "brokerage",
          balance: 3900,
          currency: "USD",
          holdingValue: 3000,
          displayValue: 3000,
          valueSource: "holdings",
        },
        {
          id: "without-holdings",
          name: "401k",
          source: "plaid",
          type: "investment",
          subtype: "401k",
          balance: 1200,
          currency: "USD",
          holdingValue: null,
          displayValue: 1200,
          valueSource: "account-balance",
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(ConnectedAccounts, { coverage, currency: "USD" }),
    );

    expect(html).toContain("Some security holdings unavailable");
    expect(html).toContain("$3,000.00");
    expect(html).not.toContain("$3,900.00");
    expect(html).toContain("$1,200.00");
  });
});
