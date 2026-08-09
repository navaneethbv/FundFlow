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
    expect(html).toContain(">Date<");
    expect(html).toContain(">Filters<");
    expect(html).toContain('aria-label="Remove search filter coffee"');
    expect(html).toContain('aria-label="Remove date filter Aug 2026"');
    expect(html).not.toContain('role="dialog"');
  });
});
