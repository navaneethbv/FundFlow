import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HoldingRow, InvestmentsPage } from "@/lib/investments";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import HoldingsTable from "@/components/investments/HoldingsTable";
import TopMovers from "@/components/investments/TopMovers";
import PerformanceChart from "@/components/investments/PerformanceChart";
import AddManualHoldingForm from "@/components/investments/AddManualHoldingForm";

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

  it("colors a positive change green and a negative one red, never a raw hex", () => {
    const positive = renderToStaticMarkup(
      createElement(HoldingsTable, {
        page: page({ byClass: [{ label: "Funds", holdings: [holding({ periodChangePct: 2 })], subtotal: 2500 }] }),
        currency: "USD",
      }),
    );
    expect(positive).toContain("text-success");

    const negative = renderToStaticMarkup(
      createElement(HoldingsTable, {
        page: page({ byClass: [{ label: "Funds", holdings: [holding({ periodChangePct: -2 })], subtotal: 2500 }] }),
        currency: "USD",
      }),
    );
    expect(negative).toContain("text-danger");
    expect(negative).not.toMatch(/color:\s*#[0-9a-f]{3,6}/i);
  });

  it("has an empty state when there are no holdings", () => {
    const html = renderToStaticMarkup(
      createElement(HoldingsTable, { page: page({ byClass: [] }), currency: "USD" }),
    );
    expect(html).toContain("No holdings yet");
  });
});

describe("TopMovers", () => {
  it("colors gains green and losses red via semantic classes", () => {
    const html = renderToStaticMarkup(
      createElement(TopMovers, {
        movers: [
          { id: "up", name: "Up Co", ticker: "UP", changePct: 3.2 },
          { id: "dn", name: "Down Co", ticker: "DN", changePct: -1.1 },
        ],
      }),
    );
    expect(html).toContain("text-success");
    expect(html).toContain("text-danger");
  });
});

describe("PerformanceChart", () => {
  it("colors a positive time-weighted return green", () => {
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
    expect(html).toContain("text-success");
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
