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

  it("colors inflows only, leaving outflows on the default foreground", () => {
    const source = readFileSync("app/transactions/page.tsx", "utf8");

    // Under the Plaid convention nearly every row is an outflow, so a red on
    // each one made the amount column a uniform block that carried no signal.
    // Money in is the exception, so it is the direction that gets a colour.
    expect(source).toContain("var(--viz-pos)");
    expect(source).not.toContain("var(--viz-neg)");
    expect(source).not.toContain("text-success");
  });

  it("collapses Edit multiple/Columns behind TableToolbar instead of two always-open bars", () => {
    const source = readFileSync("app/transactions/page.tsx", "utf8");

    expect(source).toContain("TableToolbar");
    expect(source).toContain("bulkTagBar={<BulkTagBar");
    expect(source).toContain("columnsMenu={");
    expect(source.indexOf("<TableToolbar")).toBeLessThan(source.indexOf("<MobileLedgerList"));
  });

  it("renders day totals in the amount column and suppresses repeated grouped dates", () => {
    const source = readFileSync("app/transactions/page.tsx", "utf8");

    expect(source).toContain("colSpan={columnCount - 2}");
    expect(source).toContain("dayGroup?.showNet");
    expect(source).toContain('grouped && !isNewDay ? "sr-only"');
  });

  it("uses group-local zebra bands for the desktop register", () => {
    const source = readFileSync("app/transactions/page.tsx", "utf8");

    expect(source).toContain("ledgerZebraBands(rows, showDayGroups)");
    expect(source).toContain("zebraBand % 2 === 1");
  });
});
