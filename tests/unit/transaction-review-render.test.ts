import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import { TransactionReviewStatusBadge } from "@/components/transactions/TransactionReviewStatus";
import {
  TransactionReviewBulkStrip,
  TransactionReviewCheckbox,
  TransactionReviewRowAction,
} from "@/components/transactions/TransactionReviewControls";
import { TransactionReviewProvider } from "@/components/transactions/TransactionReviewProvider";

describe("TransactionReviewStatusBadge", () => {
  it("renders 'Needs review' badge for needs_review status", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionReviewStatusBadge, { status: "needs_review" }),
    );
    expect(html).toContain("Needs review");
  });

  it("renders 'Reviewed' badge for reviewed status", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionReviewStatusBadge, { status: "reviewed" }),
    );
    expect(html).toContain("Reviewed");
  });

  it("renders 'Pending' badge when pending is true", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionReviewStatusBadge, {
        status: "needs_review",
        pending: true,
      }),
    );
    expect(html).toContain("Pending");
    expect(html).not.toContain("Needs review");
  });

  it("renders 'Excluded duplicate' badge when excludedDuplicate is true", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionReviewStatusBadge, {
        status: "needs_review",
        excludedDuplicate: true,
      }),
    );
    expect(html).toContain("Excluded duplicate");
  });

  it("renders 'Review unavailable' badge when missing is true", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionReviewStatusBadge, {
        status: "needs_review",
        missing: true,
      }),
    );
    expect(html).toContain("Review unavailable");
  });
});

describe("TransactionReviewRowAction", () => {
  it("returns empty/null when ineligible or version missing", () => {
    const htmlIneligible = renderToStaticMarkup(
      createElement(
        TransactionReviewProvider,
        null,
        createElement(TransactionReviewRowAction, {
          id: "tx-1",
          version: "1",
          eligible: false,
          status: "needs_review",
        }),
      ),
    );
    expect(htmlIneligible).toBe("");

    const htmlNoVersion = renderToStaticMarkup(
      createElement(
        TransactionReviewProvider,
        null,
        createElement(TransactionReviewRowAction, {
          id: "tx-1",
          version: null,
          eligible: true,
          status: "needs_review",
        }),
      ),
    );
    expect(htmlNoVersion).toBe("");
  });

  it("renders 'Mark reviewed' button with aria-label for unreviewed item", () => {
    const html = renderToStaticMarkup(
      createElement(
        TransactionReviewProvider,
        null,
        createElement(TransactionReviewRowAction, {
          id: "tx-1",
          version: "1",
          eligible: true,
          status: "needs_review",
          prefix: "test",
        }),
      ),
    );
    expect(html).toContain("Mark reviewed");
    expect(html).toContain('aria-label="Mark transaction as reviewed"');
    expect(html).toContain('id="test-review-btn-tx-1"');
  });

  it("renders 'Review again' button with aria-label for already reviewed item", () => {
    const html = renderToStaticMarkup(
      createElement(
        TransactionReviewProvider,
        null,
        createElement(TransactionReviewRowAction, {
          id: "tx-1",
          version: "2",
          eligible: true,
          status: "reviewed",
          prefix: "test",
        }),
      ),
    );
    expect(html).toContain("Review again");
    expect(html).toContain('aria-label="Mark transaction as needs review"');
  });
});

describe("TransactionReviewCheckbox", () => {
  it("renders empty placeholder span when not eligible", () => {
    const html = renderToStaticMarkup(
      createElement(
        TransactionReviewProvider,
        null,
        createElement(TransactionReviewCheckbox, {
          id: "tx-1",
          eligible: false,
          date: "2026-09-08",
          merchant: "Store",
          accountLabel: "Checking",
        }),
      ),
    );
    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).not.toContain('type="checkbox"');
  });

  it("renders checkbox with descriptive aria-label when eligible", () => {
    const html = renderToStaticMarkup(
      createElement(
        TransactionReviewProvider,
        null,
        createElement(TransactionReviewCheckbox, {
          id: "tx-1",
          eligible: true,
          date: "2026-09-08",
          merchant: "Store",
          accountLabel: "Checking",
          prefix: "desktop",
        }),
      ),
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('id="desktop-select-txn-tx-1"');
    expect(html).toContain(
      'aria-label="Select transaction Store on 2026-09-08 from Checking"',
    );
  });
});

describe("TransactionReviewBulkStrip", () => {
  it("returns null when no eligible rows exist", () => {
    const html = renderToStaticMarkup(
      createElement(
        TransactionReviewProvider,
        null,
        createElement(TransactionReviewBulkStrip, { eligibleRows: [] }),
      ),
    );
    expect(html).toBe("");
  });

  it("renders select-all checkbox when eligible rows exist", () => {
    const html = renderToStaticMarkup(
      createElement(
        TransactionReviewProvider,
        null,
        createElement(TransactionReviewBulkStrip, {
          eligibleRows: [
            { id: "tx-1", version: "1" },
            { id: "tx-2", version: "1" },
          ],
        }),
      ),
    );
    expect(html).toContain("Select shown (2)");
    expect(html).toContain('id="review-select-all-shown"');
  });
});
