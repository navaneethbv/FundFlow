import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Local date anchoring (frontend-review R10):
 * Client components in components/** must anchor dates to user-local time via
 * localDateKey() rather than toISOString().slice(0, 10) (UTC).
 */

function findUtcIsoSlice(dir: string): string[] {
  const offenders: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("_")) continue;
      offenders.push(...findUtcIsoSlice(full));
    } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
      const source = readFileSync(full, "utf8");
      if (source.includes("toISOString().slice(0, 10)")) {
        offenders.push(full);
      }
    }
  }
  return offenders;
}

describe("client date anchoring (localDateKey)", () => {
  it("no components contain toISOString().slice(0, 10)", () => {
    const offenders = findUtcIsoSlice("components");
    expect(
      offenders,
      `components must use localDateKey() instead of UTC date slice: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("AddTransactionModal and AddManualHoldingForm reference localDateKey", () => {
    const txnSource = readFileSync("components/transactions/AddTransactionModal.tsx", "utf8");
    const holdingSource = readFileSync("components/investments/AddManualHoldingForm.tsx", "utf8");
    expect(txnSource).toContain("localDateKey");
    expect(holdingSource).toContain("localDateKey");
  });
});
