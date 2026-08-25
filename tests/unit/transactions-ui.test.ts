import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("transactions UI restyle", () => {
  it("uses staged transaction controls instead of the legacy GET form", () => {
    const source = readFileSync("app/transactions/page.tsx", "utf8");

    expect(source).toContain("TransactionQueryControls");
    expect(source).toContain("Panel");
    expect(source).toContain("Badge");
    expect(source).toContain("ButtonLink");
    expect(source).toContain("sticky top-0");
  });

  it("colors inflows and outflows with the diverging tokens (debits included)", () => {
    const source = readFileSync("app/transactions/page.tsx", "utf8");

    expect(source).toContain("var(--viz-pos)");
    expect(source).toContain("var(--viz-neg)");
    expect(source).not.toContain("text-success");
  });

  it("collapses Edit multiple/Columns behind TableToolbar instead of two always-open bars", () => {
    const source = readFileSync("app/transactions/page.tsx", "utf8");

    expect(source).toContain("TableToolbar");
    expect(source).toContain("bulkTagBar={<BulkTagBar");
    expect(source).toContain("columnsMenu={");
    expect(source.indexOf("<TableToolbar")).toBeLessThan(source.indexOf("<MobileLedgerList"));
  });
});
