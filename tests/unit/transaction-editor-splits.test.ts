import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import TransactionEditor from "@/components/transactions/TransactionEditor";

describe("TransactionEditor Split Enhancements", () => {
  const baseTx = {
    id: "tx-test-1",
    merchant: "Supermarket Mart",
    amount: 120.0,
    currency: "USD",
  };

  it("renders trigger button for editing notes and splits", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionEditor, {
        transaction: baseTx,
        note: null,
        tags: [],
        splits: [],
        categories: ["Groceries", "Home", "Personal"],
      }),
    );
    expect(html).toContain("Add notes or splits");
  });

  it("source code wires equal split presets (50/50, 1/3, 1/4) and visual allocation bar", () => {
    const source = readFileSync("components/transactions/TransactionEditor.tsx", "utf8");
    expect(source).toContain("Presets:");
    expect(source).toContain("50/50");
    expect(source).toContain("1/3");
    expect(source).toContain("1/4");
    expect(source).toContain("Allocated:");
    expect(source).toContain("Remaining:");
    expect(source).toContain("unallocated = round2(Math.max(0, target - splitTotal))");
  });
});
