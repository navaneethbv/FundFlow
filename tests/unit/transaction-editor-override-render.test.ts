import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TransactionOverrideControl from "@/components/transactions/TransactionOverrideControl";

describe("TransactionOverrideControl", () => {
  it("renders a display category field and a cash-flow classification select", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionOverrideControl, {
        transactionId: "txn-1",
        providerCategory: "TRANSFER_OUT",
        initialOverride: { displayCategory: null, cashFlowClassification: null },
        categories: ["SHOPPING", "FOOD_AND_DRINK"],
      }),
    );
    expect(html).toContain("Display category");
    expect(html).toContain("Cash-flow classification");
    expect(html).toContain("Spending");
    expect(html).toContain("Income");
    expect(html).toContain("Follow provider");
  });

  it("pre-fills the saved override values", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionOverrideControl, {
        transactionId: "txn-1",
        providerCategory: "TRANSFER_OUT",
        initialOverride: { displayCategory: "SHOPPING", cashFlowClassification: "expense" },
        categories: [],
      }),
    );
    expect(html).toContain('value="SHOPPING"');
    expect(html).toContain('value="expense"');
    expect(html).toContain('selected');
  });

  it("warns that a provider transfer is currently excluded from cash flow", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionOverrideControl, {
        transactionId: "txn-1",
        providerCategory: "TRANSFER_OUT",
        initialOverride: { displayCategory: null, cashFlowClassification: null },
        categories: [],
      }),
    );
    expect(html).toContain("excluded from cash flow as a transfer");
  });
});