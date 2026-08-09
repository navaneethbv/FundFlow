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

  it("colors credits green but leaves debits plain foreground (Monarch does not color debits red)", () => {
    const source = readFileSync("app/transactions/page.tsx", "utf8");

    expect(source).toContain("text-success");
    expect(source).toContain("text-foreground");
    expect(source).not.toContain("var(--danger)");
  });

  it("collapses Edit multiple/Columns behind TableToolbar instead of two always-open bars", () => {
    const source = readFileSync("app/transactions/page.tsx", "utf8");

    expect(source).toContain("TableToolbar");
    expect(source).toContain("bulkTagBar={<BulkTagBar");
    expect(source).toContain("columnsMenu={");
  });
});
