import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AccountsPageData } from "@/lib/accounts-page";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

import AccountGroup from "@/components/accounts/AccountGroup";
import AccountPreferences from "@/components/accounts/AccountPreferences";
import AccountsFilters from "@/components/accounts/AccountsFilters";
import SummaryPanel from "@/components/accounts/SummaryPanel";

const row = {
  id: "cash-1",
  ownerUserId: "user-1",
  source: "plaid" as const,
  name: "Checking (...1234)",
  type: "depository",
  subtype: "checking",
  balance: 1000,
  currency: "USD",
  institution: "Test Bank",
  updatedAgo: "2 days ago",
  stale: true,
  spark: [900, 1000],
  monthChange: { amount: 100, pct: 11.11 },
  includeInNetWorth: true,
};

const data: AccountsPageData = {
  groups: {
    credit: { label: "Credit cards", totals: [], rows: [] },
    cash: {
      label: "Cash",
      totals: [{ currency: "USD", amount: 1000 }],
      rows: [row],
    },
    investment: { label: "Investments", totals: [], rows: [] },
    loan: { label: "Loans", totals: [], rows: [] },
    other: { label: "Other", totals: [], rows: [] },
  },
  summary: {
    currencies: ["CAD", "USD"],
    currencyMismatch: true,
    assets: [
      { currency: "CAD", amount: 3000 },
      { currency: "USD", amount: 1000 },
    ],
    liabilities: [{ currency: "USD", amount: 200 }],
    netWorth: [
      { currency: "CAD", amount: 3000 },
      { currency: "USD", amount: 800 },
    ],
    netWorthSeries: {
      USD: [
        { date: "2026-06-29", value: 700 },
        { date: "2026-07-29", value: 800 },
      ],
    },
    netWorthMonthChange: {
      CAD: null,
      USD: { amount: 100, pct: 14.29 },
    },
  },
  historyStartsOn: "2026-07-29",
};

describe("Accounts page components", () => {
  it("renders stale text, a balance, and month change beside the sparkline", () => {
    const html = renderToStaticMarkup(
      createElement(AccountGroup, {
        groupKey: "cash",
        group: data.groups.cash,
      }),
    );

    expect(html).toContain("Checking (...1234)");
    expect(html).toContain("$1,000.00");
    expect(html).toContain("Stale, updated 2 days ago");
    expect(html).toContain("+$100.00");
    expect(html).toContain("11.11%");
  });

  it("removes an empty sparkline slot from the phone layout", () => {
    const html = renderToStaticMarkup(
      createElement(AccountGroup, {
        groupKey: "cash",
        group: {
          ...data.groups.cash,
          rows: [{ ...row, spark: [] }],
        },
      }),
    );

    expect(html).toContain('class="hidden min-h-11 sm:block"');
  });

  it("renders honest currency and history disclosures with a table twin", () => {
    const html = renderToStaticMarkup(
      createElement(SummaryPanel, {
        summary: data.summary,
        historyStartsOn: data.historyStartsOn,
        mode: "totals",
      }),
    );

    expect(html).toContain(
      "Totals are separated by currency because FundFlow does not guess exchange rates.",
    );
    expect(html).toContain(
      "Daily balance history starts on 2026-07-29. Earlier history is unavailable.",
    );
    expect(html).toContain("View daily balance table");
    expect(html).toContain("<table");
  });

  it("does not report a fake zero-percent change without history", () => {
    const html = renderToStaticMarkup(
      createElement(SummaryPanel, {
        summary: data.summary,
        historyStartsOn: data.historyStartsOn,
        mode: "percent",
      }),
    );

    expect(html).toContain("Not enough history");
    expect(html).not.toContain(">0%<");
  });

  it("preserves account filters when switching summary mode", () => {
    const html = renderToStaticMarkup(
      createElement(SummaryPanel, {
        summary: data.summary,
        historyStartsOn: data.historyStartsOn,
        mode: "totals",
        query: {
          scope: "household-1",
          institution: "Test Bank",
        },
      }),
    );

    expect(html).toContain(
      'href="/accounts?scope=household-1&amp;institution=Test+Bank&amp;summary=percent"',
    );
  });

  it("shows owner filtering only for household scope", () => {
    const household = renderToStaticMarkup(
      createElement(AccountsFilters, {
        current: {},
        institutions: ["Test Bank"],
        householdScope: true,
        ownerOptions: [
          { value: "user-1", label: "You" },
          { value: "member-2", label: "Household member" },
        ],
      }),
    );
    const mine = renderToStaticMarkup(
      createElement(AccountsFilters, {
        current: {},
        institutions: ["Test Bank"],
        householdScope: false,
        ownerOptions: [],
      }),
    );

    expect(household).toContain("Owner");
    expect(household).toContain("Household member");
    expect(mine).not.toContain("Owner");
  });

  it("renders keyboard-operable visibility and ordering controls", () => {
    const html = renderToStaticMarkup(
      createElement(AccountPreferences, {
        accounts: [{ id: "cash-1", name: "Checking (...1234)" }],
        initialPrefs: { hiddenIds: [], order: ["cash-1"] },
      }),
    );

    expect(html).toContain('aria-label="Move Checking (...1234) up"');
    expect(html).toContain('aria-label="Move Checking (...1234) down"');
    expect(html).toContain(">Hide<");
  });
});
