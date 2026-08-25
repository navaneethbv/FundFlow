import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RecurringOccurrence } from "@/lib/recurring-page";
import type { ManualRecurringItemRow, RecurringStreamRow } from "@/lib/recurring-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import RecurringList from "@/components/recurring/RecurringList";
import ReviewBanner from "@/components/recurring/ReviewBanner";

const LINKS = {
  upcoming: "/recurring?month=2026-07",
  complete: "/recurring?month=2026-07&tab=complete",
  manage: "/recurring?month=2026-07&tab=manage",
};

function occurrence(overrides: Partial<RecurringOccurrence> = {}): RecurringOccurrence {
  return {
    source: "plaid",
    sourceId: "stream-1",
    merchant: "Netflix",
    frequency: "Every month",
    dueDate: "2026-07-15",
    account: "Checking",
    category: "SUBSCRIPTION",
    amount: 15.49,
    status: "upcoming",
    matchedTransactionId: null,
    isIncome: false,
    ...overrides,
  };
}

function stream(overrides: Partial<RecurringStreamRow> = {}): RecurringStreamRow {
  return {
    id: "stream-1",
    merchantName: "Netflix",
    description: null,
    streamType: "outflow",
    status: "MATURE",
    isActive: true,
    reviewedAt: "2026-01-01T00:00:00Z",
    dismissedAt: null,
    userAmount: null,
    averageAmount: 15.49,
    accountName: "Checking",
    isOwn: true,
    ...overrides,
  };
}

function manualItem(overrides: Partial<ManualRecurringItemRow> = {}): ManualRecurringItemRow {
  return {
    id: "manual-1",
    name: "Piano lessons",
    amount: 80,
    frequency: "monthly",
    nextDate: "2026-07-05",
    itemType: "expense",
    category: null,
    enabled: true,
    ...overrides,
  };
}

describe("RecurringList — Upcoming/Complete tables", () => {
  it("renders the occurrence table with Merchant/Date/Payment Account/Category/Amount columns", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [occurrence()],
        streams: [stream()],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(html).toContain("Merchant");
    expect(html).toContain("Payment Account");
    expect(html).toContain("Category");
    expect(html).toContain("Netflix");
    expect(html).toContain("$15.49");
    expect(html).toContain("Checking");
  });

  it("shows an orange overdue annotation next to the due date", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [occurrence({ status: "overdue", dueDate: "2026-07-01" })],
        streams: [stream()],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(html).toContain("text-accent");
    expect(html).toContain("9 days ago");
  });

  it("shows a Complete Total band with the summed amount", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [
          occurrence({ status: "complete", amount: 10, matchedTransactionId: "t1" }),
          occurrence({ status: "complete", amount: 20, sourceId: "stream-2", matchedTransactionId: "t2" }),
        ],
        streams: [stream()],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "complete",
        links: LINKS,
      }),
    );
    expect(html).toContain("Complete Total");
    expect(html).toContain("$30.00");
  });

  it("renders an empty state instead of a table when there are no occurrences", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [],
        streams: [],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(html).toContain("Nothing upcoming this month.");
    expect(html).not.toContain("<table");
  });

  it("renders a read-only note for a shared, non-owned stream instead of a menu", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [occurrence()],
        streams: [stream({ isOwn: false })],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(html).toContain("Shared · view only");
    expect(html).not.toContain("More options for Netflix");
  });

  it("surfaces Confirm/Not recurring on the row menu trigger for a stream that needs review", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [occurrence()],
        streams: [stream({ reviewedAt: null })],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(html).toContain("More options for Netflix");
  });

  it("gives a manual item's row an Enabled toggle and Delete instead of a review menu", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [
          occurrence({
            source: "manual",
            sourceId: "manual-1",
            merchant: "Piano lessons",
            account: null,
            category: null,
          }),
        ],
        streams: [],
        manualItems: [manualItem()],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(html).toContain("More options for Piano lessons");
  });

  it("zebra-stripes odd-indexed rows and not even-indexed ones", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [
          occurrence({ sourceId: "stream-1" }),
          occurrence({ sourceId: "stream-2", merchant: "Spotify" }),
        ],
        streams: [stream(), stream({ id: "stream-2", merchantName: "Spotify" })],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    const rows = html.split("<tr").slice(1); // rows[0] is the <thead> row
    expect(rows[1]).not.toContain("bg-panel-2");
    expect(rows[2]).toContain("bg-panel-2");
  });

  it("colors an expense with the negative diverging token and an income with the positive one", () => {
    const expenseHtml = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [occurrence({ isIncome: false })],
        streams: [stream()],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(expenseHtml).toContain("var(--viz-neg)");

    const incomeHtml = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [occurrence({ isIncome: true })],
        streams: [stream()],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(incomeHtml).toContain("var(--viz-pos)");
    expect(incomeHtml).not.toContain("text-success");
  });

  it("mono-izes the column header row", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [occurrence()],
        streams: [stream()],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(html).toContain('class="bg-panel-2 text-xs text-muted font-mono"');
  });
});

describe("RecurringList — tabs are URL-driven, not client state", () => {
  it("renders three Tabs links pointing at the links prop, with counts", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [occurrence()],
        streams: [stream()],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(html).toContain(`href="${LINKS.upcoming}"`);
    expect(html).toContain(`href="${LINKS.complete.replaceAll("&", "&amp;")}"`);
    expect(html).toContain(`href="${LINKS.manage.replaceAll("&", "&amp;")}"`);
    expect(html).toContain("Upcoming (1)");
    expect(html).toContain("Manage (1)");
  });
});

describe("RecurringList — Manage tab", () => {
  it("still renders the full stream list and the manual-item add form", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [],
        streams: [stream()],
        manualItems: [manualItem()],
        currency: "USD",
        today: "2026-07-10",
        tab: "manage",
        links: LINKS,
      }),
    );
    expect(html).toContain("Manual items");
    expect(html).toContain("Piano lessons");
    expect(html).toContain('aria-label="Manual item name"');
  });

  it("marks a manual expense item's amount with the privacy-blur hook and the negative diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [],
        streams: [],
        manualItems: [manualItem({ itemType: "expense", amount: 80 })],
        currency: "USD",
        today: "2026-07-10",
        tab: "manage",
        links: LINKS,
      }),
    );
    expect(html).toContain("data-money");
    expect(html).toContain("var(--viz-neg)");
  });

  it("colors a manual income item's amount with the positive diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [],
        streams: [],
        manualItems: [manualItem({ itemType: "income", amount: 500, name: "Freelance" })],
        currency: "USD",
        today: "2026-07-10",
        tab: "manage",
        links: LINKS,
      }),
    );
    expect(html).toContain("var(--viz-pos)");
  });
});

describe("ReviewBanner", () => {
  it("renders nothing when there is nothing to review", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewBanner, { reviewCount: 0, reviewHref: "/recurring?tab=manage" }),
    );
    expect(html).toBe("");
  });

  it("renders a Review now link pointing at the manage tab", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewBanner, { reviewCount: 2, reviewHref: "/recurring?tab=manage" }),
    );
    expect(html).toContain("There are 2 new recurring merchants for you to review.");
    expect(html).toContain('href="/recurring?tab=manage"');
    expect(html).toContain("Review now");
  });
});
