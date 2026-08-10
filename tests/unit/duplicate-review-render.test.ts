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
});
