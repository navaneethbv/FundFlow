import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DuplicateReview from "@/components/transactions/DuplicateReview";

const first = {
  id: "a",
  date: "2026-08-01",
  merchant: "Cafe",
  amount: 20,
  accountId: "account-1",
  plaidItemId: "item-1",
  accountName: "Card A",
};
const second = { ...first, id: "b", accountId: "account-2", accountName: "Card B" };

describe("DuplicateReview", () => {
  it("shows both transactions and requires an explicit keep choice", () => {
    const html = renderToStaticMarkup(createElement(DuplicateReview, {
      initialPairs: [{ subjectId: "a:b", first, second, dateDistanceDays: 1 }],
      initialConfirmed: [],
    }));

    expect(html).toContain("Card A");
    expect(html).toContain("Card B");
    expect(html).toContain("Keep this transaction");
    expect(html).toContain("Confirm duplicate");
    expect(html).toContain("disabled");
    expect(html).toContain("Dismiss");
  });

  it("shows confirmed exclusions with undo", () => {
    const html = renderToStaticMarkup(createElement(DuplicateReview, {
      initialPairs: [],
      initialConfirmed: [{ subjectId: "a:b", kept: first, excluded: second }],
    }));

    expect(html).toContain("Excluded duplicate");
    expect(html).toContain("Undo");
  });

  it("renders only one full review form when dozens of candidates exist", () => {
    const manyPairs: Array<{
      subjectId: string;
      first: typeof first;
      second: typeof second;
      dateDistanceDays: number;
    }> = Array.from({ length: 50 }, (_, index) => ({
      subjectId: `pair-${index}`,
      first: { ...first, id: `a-${index}`, merchant: `Cafe ${index}` },
      second: { ...second, id: `b-${index}`, merchant: `Cafe ${index}` },
      dateDistanceDays: 1,
    }));
    const html = renderToStaticMarkup(createElement(DuplicateReview, {
      initialPairs: manyPairs,
      initialConfirmed: [],
    }));

    // Only the first candidate's full form is in the DOM...
    expect((html.match(/Choose the transaction to keep/g) ?? []).length).toBe(1);
    expect((html.match(/Confirm duplicate/g) ?? []).length).toBe(1);
    expect((html.match(/Dismiss/g) ?? []).length).toBe(1);
    // ...while the summary still states the true candidate count.
    expect(html).toContain("50 duplicate candidates to review");
    // Every remaining candidate stays in the client state, not dropped to
    // shrink the DOM — none of their forms should be missing silently.
    for (let index = 1; index < 50; index += 1) {
      expect(html).not.toContain(`Cafe ${index}`);
    }
  });

  it("carries an accessible status region for decision announcements", () => {
    const html = renderToStaticMarkup(createElement(DuplicateReview, {
      initialPairs: [{ subjectId: "a:b", first, second, dateDistanceDays: 1 }],
      initialConfirmed: [],
    }));
    expect(html).toContain('data-duplicate-status');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("1 duplicate candidate to review");
  });

  it("reports a fully reviewed queue with no candidates left", () => {
    const html = renderToStaticMarkup(createElement(DuplicateReview, {
      initialPairs: [],
      initialConfirmed: [{ subjectId: "a:b", kept: first, excluded: second }],
    }));
    expect(html).toContain("No duplicate candidates to review.");
    // The resolved list is collapsed behind a count summary.
    expect(html).toContain("1 resolved duplicate");
  });
});
