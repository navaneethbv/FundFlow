import { describe, it, expect } from "vitest";
import {
  parseCsv,
  detectColumns,
  normalizeColumnMap,
  getCsvColumns,
  normalizeDate,
  parseAmount,
  parseImportCsv,
  makeImportId,
} from "@/lib/import";

describe("parseCsv", () => {
  it("parses quoted fields, escaped quotes, and CRLF", () => {
    const rows = parseCsv('a,"b,1","say ""hi"""\r\nc,d,e\n');
    expect(rows).toEqual([
      ["a", "b,1", 'say "hi"'],
      ["c", "d", "e"],
    ]);
  });

  it("ignores empty lines and handles a missing trailing newline", () => {
    expect(parseCsv("a,b\n\n\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles newlines inside quoted fields", () => {
    expect(parseCsv('a,"line1\nline2"\nb,c')).toEqual([
      ["a", "line1\nline2"],
      ["b", "c"],
    ]);
  });
});

describe("detectColumns", () => {
  it("detects a single signed amount layout", () => {
    const map = detectColumns(["Date", "Description", "Amount"]);
    expect(map).toMatchObject({ date: 0, description: 1, amount: 2 });
  });

  it("detects split debit/credit layouts and category", () => {
    const map = detectColumns(["Posted Date", "Payee", "Debit", "Credit", "Category"]);
    expect(map).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3, category: 4 });
  });

  it("returns null when essentials are missing", () => {
    expect(detectColumns(["Foo", "Bar"])).toBeNull();
    expect(detectColumns(["Date", "Description"])).toBeNull(); // no amount
  });
});

describe("normalizeColumnMap", () => {
  it("accepts an explicit map with required fields in range", () => {
    expect(normalizeColumnMap({ date: 0, description: 1, amount: 2 }, 3)).toEqual({
      date: 0,
      description: 1,
      amount: 2,
      debit: null,
      credit: null,
      category: null,
    });
  });

  it("accepts a debit/credit map with a category", () => {
    expect(normalizeColumnMap({ date: 1, description: 0, debit: 2, credit: 3, category: 4 }, 5)).toEqual({
      date: 1,
      description: 0,
      amount: null,
      debit: 2,
      credit: 3,
      category: 4,
    });
  });

  it("rejects out-of-range, missing, or amount-less maps", () => {
    expect(normalizeColumnMap({ date: 0, description: 1 }, 3)).toBeNull(); // no amount/debit/credit
    expect(normalizeColumnMap({ date: 5, description: 1, amount: 2 }, 3)).toBeNull(); // out of range
    expect(normalizeColumnMap({ description: 1, amount: 2 }, 3)).toBeNull(); // no date
    expect(normalizeColumnMap(null, 3)).toBeNull();
  });
});

describe("getCsvColumns", () => {
  it("returns headers and up to three sample rows", () => {
    const result = getCsvColumns("A,B,C\n1,2,3\n4,5,6\n7,8,9\n10,11,12");
    expect(result?.headers).toEqual(["A", "B", "C"]);
    expect(result?.sample).toHaveLength(3);
    expect(result?.sample[0]).toEqual(["1", "2", "3"]);
  });
});

describe("parseImportCsv with an explicit column map", () => {
  it("uses the provided map instead of auto-detection", () => {
    // Header names are unrecognizable, so detection would fail; the map rescues it.
    const csv = "col0,col1,col2\n2026-07-05,Coffee Shop,4.50\n2026-07-06,Paycheck,-1000";
    const result = parseImportCsv(csv, {
      positiveIsIncome: false,
      columns: { date: 0, description: 1, amount: 2, debit: null, credit: null, category: null },
    });
    expect(result.rows).toEqual([
      { date: "2026-07-05", amount: 4.5, merchant: "Coffee Shop", category: null },
      { date: "2026-07-06", amount: -1000, merchant: "Paycheck", category: null },
    ]);
  });
});

describe("normalizeDate", () => {
  it("accepts ISO and US formats", () => {
    expect(normalizeDate("2024-03-07")).toBe("2024-03-07");
    expect(normalizeDate("03/07/2024")).toBe("2024-03-07");
    expect(normalizeDate("3/7/24")).toBe("2024-03-07");
    expect(normalizeDate("12/31/99")).toBe("1999-12-31");
  });

  it("rejects impossible dates", () => {
    expect(normalizeDate("2024-02-30")).toBeNull();
    expect(normalizeDate("13/40/2024")).toBeNull();
    expect(normalizeDate("yesterday")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("strips currency formatting and handles parens negatives", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("(45.00)")).toBe(-45);
    expect(parseAmount("-12.5")).toBe(-12.5);
  });

  it("rejects non-numbers", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
  });
});

describe("parseImportCsv", () => {
  const csv = [
    "Date,Description,Amount,Category",
    "2019-05-01,COFFEE SHOP,-4.50,Dining",
    "2019-05-02,PAYCHECK,1500.00,Income",
    "bad-date,MYSTERY,1.00,",
  ].join("\n");

  it("normalizes to Plaid sign convention with positiveIsIncome", () => {
    // Bank convention: negative = money out → flip to Plaid (positive = out).
    const { rows, errors } = parseImportCsv(csv, { positiveIsIncome: true });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      date: "2019-05-01",
      amount: 4.5,
      merchant: "COFFEE SHOP",
      category: "Dining",
    });
    expect(rows[1]!.amount).toBe(-1500); // income is negative in Plaid signs
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Line 4");
  });

  it("maps split debit/credit columns to signed amounts", () => {
    const split = [
      "Date,Description,Debit,Credit",
      "2019-05-01,GROCERY,50.25,",
      "2019-05-02,DEPOSIT,,200.00",
    ].join("\n");
    const { rows, errors } = parseImportCsv(split, { positiveIsIncome: false });
    expect(errors).toHaveLength(0);
    expect(rows[0]!.amount).toBe(50.25);
    expect(rows[1]!.amount).toBe(-200);
  });

  it("fails loudly on undetectable layouts", () => {
    const { rows, errors } = parseImportCsv("Foo,Bar\n1,2", { positiveIsIncome: false });
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain("Could not detect columns");
  });
});

describe("makeImportId", () => {
  const row = { date: "2019-05-01", amount: 4.5, merchant: "COFFEE", category: null };

  it("is deterministic (re-imports are idempotent)", () => {
    expect(makeImportId("acct-1", row, 0)).toBe(makeImportId("acct-1", row, 0));
    expect(makeImportId("acct-1", row, 0)).toMatch(/^import-[0-9a-f]{40}$/);
  });

  it("distinguishes occurrences, accounts, and differing rows", () => {
    expect(makeImportId("acct-1", row, 0)).not.toBe(makeImportId("acct-1", row, 1));
    expect(makeImportId("acct-2", row, 0)).not.toBe(makeImportId("acct-1", row, 0));
    expect(makeImportId("acct-1", { ...row, amount: 4.51 }, 0)).not.toBe(
      makeImportId("acct-1", row, 0),
    );
  });
});
