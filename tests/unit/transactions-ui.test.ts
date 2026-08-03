import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("transactions UI restyle", () => {
  it("uses shared primitives without changing GET filter behavior", () => {
    const source = readFileSync("app/transactions/page.tsx", "utf8");

    expect(source).toContain("method=\"get\"");
    expect(source).toContain("action=\"/transactions\"");
    expect(source).toContain("Panel");
    expect(source).toContain("Input");
    expect(source).toContain("Select");
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
