import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
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

  it("refreshes server data after save and keeps clear available for a new override", () => {
    const source = readFileSync(
      new URL("../../components/transactions/TransactionOverrideControl.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("const router = useRouter()");
    expect(source.match(/router\.refresh\(\)/g)).toHaveLength(2);
    expect(source).toContain("hasOverride");
    expect(source).toContain("disabled={saving}");
  });

  it("passes the raw primary-or-detailed provider group to the override control", () => {
    const source = readFileSync(
      new URL("../../app/transactions/page.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("providerCategory: t.pfc_primary ?? t.pfc_detailed");
  });
});
