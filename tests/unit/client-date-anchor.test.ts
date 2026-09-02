import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanFileContents } from "./test-utils";

/**
 * Local date anchoring (frontend-review R10):
 * Client components in components/** must anchor dates to user-local time via
 * localDateKey() rather than toISOString().slice(0, 10) (UTC).
 */

describe("client date anchoring (localDateKey)", () => {
  it("no components contain toISOString().slice(0, 10)", () => {
    const offenders = scanFileContents("components", (source) =>
      source.includes("toISOString().slice(0, 10)"),
    );
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
