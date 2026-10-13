import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import TransactionQueryControls from "@/components/transactions/TransactionQueryControls";

describe("TransactionQueryControls", () => {
  it("renders one visible search plus staged Date and Filters triggers", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionQueryControls, {
        committed: {
          q: "coffee",
          month: "2026-08",
          accountId: "",
          category: "",
          sub: "",
          merchant: "",
          flow: "",
          accountType: "",
          review: "all",
        },
        entries: [["q", "coffee"], ["month", "2026-08"]],
        options: {
          accounts: [],
          categories: [],
          subcategoriesByCategory: {},
          merchants: [],
        },
      }),
    );

    expect(html).toContain('aria-label="Search transactions"');
    expect(html).toContain(">Search<");
    expect(html).toContain("Date: Aug 2026");
    expect(html).toContain(">Filters<");
    expect(html).toContain('aria-label="Remove search filter coffee"');
    expect(html).toContain('aria-label="Remove date filter Aug 2026"');
    expect(html).not.toContain('role="dialog"');
  });

  it("renders review segmented views and queue count when reviewEnabled is true", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionQueryControls, {
        committed: {
          q: "",
          month: "",
          accountId: "",
          category: "",
          sub: "",
          merchant: "",
          flow: "",
          accountType: "",
          review: "needs_review",
        },
        entries: [["review", "needs_review"]],
        options: {
          accounts: [],
          categories: [],
          subcategoriesByCategory: {},
          merchants: [],
        },
        reviewEnabled: true,
        needsReviewGlobalCount: 7,
      }),
    );

    expect(html).toContain('aria-label="Transaction review views"');
    expect(html).toContain("Needs review");
    expect(html).toContain("Reviewed");
    expect(html).toContain("7 transactions need review across all dates and accounts.");
  });

  it("renders all-caught-up message when needsReviewGlobalCount is 0", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionQueryControls, {
        committed: {
          q: "",
          month: "",
          accountId: "",
          category: "",
          sub: "",
          merchant: "",
          flow: "",
          accountType: "",
          review: "all",
        },
        entries: [],
        options: {
          accounts: [],
          categories: [],
          subcategoriesByCategory: {},
          merchants: [],
        },
        reviewEnabled: true,
        needsReviewGlobalCount: 0,
      }),
    );

    expect(html).toContain("You&#x27;re all caught up across all accounts.");
  });
});

it("renders removable chips for dates and every metadata filter", async () => {
  const { parseLedgerQuery, ledgerQueryEntries } = await import("@/lib/ledger-query");
  const state = parseLedgerQuery({ start: "2024-02-29", end: "2024-03-01", tag: "work", tagState: "tagged", note: "50%", cleared: "uncleared", source: "import", receipt: "missing", split: "split" });
  const html = renderToStaticMarkup(createElement(TransactionQueryControls, { committed: state, entries: ledgerQueryEntries(state), options: { accounts: [], categories: [], subcategoriesByCategory: {}, merchants: [] }, parityEnabled: true, detailsEnabled: true }));
  for (const label of ["custom date range", "tag", "tag status", "note", "cleared status", "source", "receipt", "split"]) expect(html).toContain(`aria-label="Remove ${label} filter"`);
  expect(html).toContain("Clear filters");
});

it("keeps filters and sort in calendar drilldowns while returning to the list", async () => {
  const { default: TransactionCalendar } = await import("@/components/transactions/TransactionCalendar");
  const { parseLedgerQuery, ledgerQueryEntries } = await import("@/lib/ledger-query");
  const state = parseLedgerQuery({ view: "calendar", start: "2024-02-29", end: "2024-03-01", tag: "work", note: "50%", source: "import", sort: "amount", page: "3" });
  const html = renderToStaticMarkup(createElement(TransactionCalendar, { month: "2024-02", rows: [{ id: "t1", date: "2024-02-29", amount: 5, merchant: "Cafe" }], entries: ledgerQueryEntries(state) }));
  const href = html.match(/href="([^"]*day=2024-02-29[^"]*)"/)?.[1]?.replaceAll("&amp;", "&");
  expect(href).toBeTruthy();
  const query = new URL(href!, "https://fundflow.test").searchParams;
  expect(query.get("tag")).toBe("work");
  expect(query.get("note")).toBe("50%");
  expect(query.get("source")).toBe("import");
  expect(query.get("sort")).toBe("amount");
  expect(query.has("view")).toBe(false);
  expect(query.has("page")).toBe(false);
});
