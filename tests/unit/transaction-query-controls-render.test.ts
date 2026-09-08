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
