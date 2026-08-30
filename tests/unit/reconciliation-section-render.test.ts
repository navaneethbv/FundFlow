import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReconciliationSection from "@/components/settings/ReconciliationSection";

describe("ReconciliationSection", () => {
  it("renders a semantic desktop table and a labeled mobile twin", () => {
    const html = renderToStaticMarkup(
      createElement(ReconciliationSection, {
        rows: [
          {
            accountId: "account-1",
            plaidItemId: "item-1",
            accountName: "Checking",
            mask: "1234",
            providerBalance: 100,
            ledgerBalance: 95,
            difference: 5,
            anchorDate: "2026-08-01",
            oldestTransactionDate: "2026-07-01",
            newestTransactionDate: "2026-08-29",
            accountsUpdatedAt: "2026-08-29T10:00:00.000Z",
            state: "difference",
          },
        ],
      }),
    );

    expect(html).toContain("<table");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain('aria-label="Account reconciliation details"');
    expect(html).toContain("2026-07-01 to 2026-08-29");
    expect(html).toContain("Balance refreshed: Aug 29, 2026");
    expect(html).not.toContain("2026-08-29T10:00:00.000Z");
  });
});
