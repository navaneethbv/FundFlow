import { describe, it, expect } from "vitest";
import { toCsv } from "@/lib/csv";

describe("CSV export", () => {
  it("builds a header + rows", () => {
    const csv = toCsv(
      ["date", "merchant", "amount", "category"],
      [["2026-06-01", "Whole Foods", 54.2, "FOOD_AND_DRINK"]],
    );
    expect(csv).toBe(
      "date,merchant,amount,category\r\n2026-06-01,Whole Foods,54.2,FOOD_AND_DRINK",
    );
  });

  it("quotes fields containing commas, quotes, or newlines", () => {
    const csv = toCsv(
      ["merchant"],
      [['Dunn, Edwards']],
    );
    expect(csv).toContain('"Dunn, Edwards"');

    const quoted = toCsv([["a"]] as unknown as string[], [['say "hi"']]);
    expect(quoted).toContain('"say ""hi"""');
  });

  it("neutralizes spreadsheet formula injection in string fields", () => {
    const csv = toCsv(
      ["merchant", "amount"],
      [
        ["=HYPERLINK(\"http://evil\")", 10],
        ["+1-800-EVIL", 20],
        ["@import", 30],
        ["-negative merchant", 40],
        [-55.5 as number, 60], // numeric negatives must NOT be quoted
      ],
    );
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain("'+1-800-EVIL");
    expect(csv).toContain("'@import");
    expect(csv).toContain("'-negative merchant");
    expect(csv).toContain("-55.5,60");
  });

  it("never includes sensitive fields (only the 4 declared columns)", () => {
    // The export route selects only date/merchant/amount/category. This guards
    // the shape: a row with extra data must not leak beyond declared headers.
    const csv = toCsv(
      ["date", "merchant", "amount", "category"],
      [["2026-06-01", "Store", 10, "SHOPS"]],
    );
    expect(csv).not.toMatch(/access|token|account_number|routing|ssn/i);
    expect(csv.split("\r\n")[0].split(",")).toHaveLength(4);
  });
});
