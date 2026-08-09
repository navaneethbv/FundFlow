import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import TransactionSortMenu from "@/components/transactions/TransactionSortMenu";

describe("TransactionSortMenu", () => {
  it("renders a readable committed summary with one collapsed popover", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionSortMenu, {
        field: "amount",
        direction: "desc",
        entries: [["sort", "amount"]],
      }),
    );

    expect(html).toContain("Sort: Amount, high to low");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('role="dialog"');
  });
});
