import { describe, it, expect } from "vitest";
import { parseMintCsv } from "@/lib/import-mint";
import { parseMonarchCsv } from "@/lib/import-monarch";
import { parseYnabCsv } from "@/lib/import-ynab";
import {
  detectColumns,
  getCsvColumns,
  normalizeColumnMap,
  normalizeDate,
  parseAmount,
  twoColumnToSignedAmount,
  parseImportCsv,
  makeImportId,
  detectSourceFormat,
} from "@/lib/import";

describe("Mint Parser Edge Cases", () => {
  it("returns error on empty or single line CSV", () => {
    expect(parseMintCsv("")).toEqual({ rows: [], errors: ["File has no data rows."] });
    expect(parseMintCsv('"Date","Description"')).toEqual({
      rows: [],
      errors: ["File has no data rows."],
    });
  });

  it("returns error on missing required columns", () => {
    const csv = '"Date","Description","Amount"\n"2026-01-01","Store","10.00"';
    const result = parseMintCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("Could not detect Mint columns");
  });

  it("handles missing/empty description", () => {
    const csv = [
      '"Date","Description","Original Description","Amount","Transaction Type","Category"',
      '"2026-07-01","","Orig Desc","10.00","debit","Shopping"',
    ].join("\n");
    const result = parseMintCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toContain("empty description");
  });

  it("handles category column missing or blank", () => {
    const csvNoCat = [
      '"Date","Description","Original Description","Amount","Transaction Type"',
      '"2026-07-01","Store","Orig Desc","10.00","debit"',
    ].join("\n");
    const resNoCat = parseMintCsv(csvNoCat);
    expect(resNoCat.rows[0]?.category).toBeNull();

    const csvBlankCat = [
      '"Date","Description","Original Description","Amount","Transaction Type","Category"',
      '"2026-07-01","Store","Orig Desc","10.00","debit","   "',
    ].join("\n");
    const resBlankCat = parseMintCsv(csvBlankCat);
    expect(resBlankCat.rows[0]?.category).toBeNull();
  });
});

describe("Monarch Parser Edge Cases", () => {
  it("returns error on empty or single line CSV", () => {
    expect(parseMonarchCsv("")).toEqual({ rows: [], errors: ["File has no data rows."] });
    expect(parseMonarchCsv('"Date","Merchant"')).toEqual({
      rows: [],
      errors: ["File has no data rows."],
    });
  });

  it("returns error on missing required columns", () => {
    const csv = '"Date","Category","Amount"\n"2026-01-01","Food","10.00"';
    const result = parseMonarchCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("Could not detect Monarch columns");
  });

  it("handles empty merchant, bad date, bad amount", () => {
    const csv = [
      '"Date","Merchant","Category","Account","Original Statement","Notes","Amount"',
      '"bad-date","Store","Cat","Acc","Orig","Note","-10.00"',
      '"2026-07-01","Store","Cat","Acc","Orig","Note","invalid-amt"',
      '"2026-07-01","   ","Cat","Acc","Orig","Note","-10.00"',
    ].join("\n");
    const result = parseMonarchCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toContain("unrecognized date");
    expect(result.errors[1]).toContain("unrecognized amount");
    expect(result.errors[2]).toContain("empty merchant");
  });

  it("handles blank category and missing category column", () => {
    const csv = [
      '"Date","Merchant","Account","Original Statement","Notes","Amount"',
      '"2026-07-01","Store","Acc","Orig","Note","-10.00"',
    ].join("\n");
    const res = parseMonarchCsv(csv);
    expect(res.rows[0]?.category).toBeNull();

    const csvBlank = [
      '"Date","Merchant","Category","Account","Original Statement","Notes","Amount"',
      '"2026-07-01","Store","  ","Acc","Orig","Note","-10.00"',
    ].join("\n");
    const resBlank = parseMonarchCsv(csvBlank);
    expect(resBlank.rows[0]?.category).toBeNull();
  });
});

describe("YNAB Parser Edge Cases", () => {
  it("returns error on empty or single line CSV", () => {
    expect(parseYnabCsv("")).toEqual({ rows: [], errors: ["File has no data rows."] });
    expect(parseYnabCsv('"Date","Payee"')).toEqual({
      rows: [],
      errors: ["File has no data rows."],
    });
  });

  it("returns error on missing required columns", () => {
    const csv = '"Date","Memo"\n"2026-01-01","Memo"';
    const result = parseYnabCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("Could not detect YNAB columns");
  });

  it("handles bad dates, amounts, and empty payee", () => {
    const csv = [
      '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
      '"Checking","","bad-date","Store","Group: Cat","Group","Cat","Memo","$10.00","","Cleared"',
      '"Checking","","2026-07-01","Store","Group: Cat","Group","Cat","Memo","invalid","invalid","Cleared"',
      '"Checking","","2026-07-01","  ","Group: Cat","Group","Cat","Memo","$10.00","","Cleared"',
    ].join("\n");
    const result = parseYnabCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toContain("unrecognized date");
    expect(result.errors[1]).toContain("unrecognized amount");
    expect(result.errors[2]).toContain("empty payee");
  });

  it("handles blank category and missing category columns", () => {
    const csv = [
      '"Account","Flag","Date","Payee","Memo","Outflow","Inflow","Cleared"',
      '"Checking","","2026-07-01","Store","Memo","$10.00","","Cleared"',
    ].join("\n");
    const res = parseYnabCsv(csv);
    expect(res.rows[0]?.category).toBeNull();

    const csvBlank = [
      '"Account","Flag","Date","Payee","Category Group/Category","Memo","Outflow","Inflow","Cleared"',
      '"Checking","","2026-07-01","Store","   ","Memo","$10.00","","Cleared"',
    ].join("\n");
    const resBlank = parseYnabCsv(csvBlank);
    expect(resBlank.rows[0]?.category).toBeNull();
  });
});

describe("Generic CSV Parser and Utility Edge Cases", () => {
  it("detectColumns identifies debit/credit pairs vs single amount", () => {
    const headerTwoCol = ["Date", "Description", "Debit", "Credit", "Category"];
    const detectedTwo = detectColumns(headerTwoCol);
    expect(detectedTwo?.debit).toBe(2);
    expect(detectedTwo?.credit).toBe(3);
    expect(detectedTwo?.amount).toBeNull();

    const headerSingle = ["Transaction Date", "Payee", "Amount"];
    const detectedSingle = detectColumns(headerSingle);
    expect(detectedSingle?.amount).toBe(2);
    expect(detectedSingle?.debit).toBeNull();
    expect(detectedSingle?.credit).toBeNull();

    const headerMissing = ["Foo", "Bar"];
    expect(detectColumns(headerMissing)).toBeNull();
  });

  it("getCsvColumns parses column headers with empty fallbacks", () => {
    expect(getCsvColumns("")).toBeNull();
    expect(getCsvColumns("Date,Description,Amount")).toEqual({
      headers: ["Date", "Description", "Amount"],
      sample: [],
    });
  });

  it("normalizeColumnMap validates requirements", () => {
    expect(normalizeColumnMap({}, 5)).toBeNull();
    expect(normalizeColumnMap({ date: 0, description: 1 }, 5)).toBeNull(); // missing amount or debit/credit
    expect(normalizeColumnMap({ date: 0, description: 1, debit: 2 }, 5)).toBeDefined();

    const valid = normalizeColumnMap({ date: 0, description: 1, amount: 2, category: 3 }, 5);
    expect(valid).toEqual({
      date: 0,
      description: 1,
      amount: 2,
      debit: null,
      credit: null,
      category: 3,
    });
  });

  it("normalizeDate handles invalid leap years and out-of-range dates", () => {
    expect(normalizeDate("2026-02-30")).toBeNull();
    expect(normalizeDate("2026-13-01")).toBeNull();
    expect(normalizeDate("02/30/2026")).toBeNull();
    expect(normalizeDate("random-string")).toBeNull();
  });

  it("parseAmount handles negative parentheses, currencies, and invalid numbers", () => {
    expect(parseAmount("($50.25)")).toBe(-50.25);
    expect(parseAmount("  ")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("12.34.56")).toBeNull();
  });

  it("twoColumnToSignedAmount handles zero and empty strings", () => {
    expect(twoColumnToSignedAmount(undefined, undefined)).toBeNull();
    expect(twoColumnToSignedAmount("", "")).toBeNull();
    expect(twoColumnToSignedAmount("0.00", "0.00")).toBe(0);
    expect(twoColumnToSignedAmount("10.00", undefined)).toBe(10);
    expect(twoColumnToSignedAmount(undefined, "20.00")).toBe(-20);
  });

  it("parseImportCsv handles positiveIsIncome toggle and custom column mappings", () => {
    const csv = "Date,Desc,Out,In,Cat\n2026-07-01,Coffee,4.50,,Food\n2026-07-02,Salary,,2000,Income";
    const customMap = {
      date: 0,
      description: 1,
      amount: null,
      debit: 2,
      credit: 3,
      category: 4,
    };
    const res = parseImportCsv(csv, { positiveIsIncome: false, columns: customMap });
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]?.amount).toBe(4.5);
    expect(res.rows[1]?.amount).toBe(-2000);

    const csvSingle = "Date,Description,Amount\n2026-07-01,Store,50.00";
    const resIncomeTrue = parseImportCsv(csvSingle, { positiveIsIncome: true });
    expect(resIncomeTrue.rows[0]?.amount).toBe(-50.0);

    const csvBadLines = [
      "Date,Description,Amount,Category",
      "bad-date,Store,10,Food",
      "2026-07-01,,10,Food",
      "2026-07-01,Store,bad-amt,Food",
      "2026-07-01,Store,10,  ",
    ].join("\n");
    const resBad = parseImportCsv(csvBadLines, { positiveIsIncome: false });
    expect(resBad.errors).toHaveLength(3);
    expect(resBad.rows[0]?.category).toBeNull();
  });

  it("parseImportCsv returns error on empty input or unparseable columns", () => {
    expect(parseImportCsv("", { positiveIsIncome: false })).toEqual({
      rows: [],
      errors: ["File has no data rows."],
    });
    expect(parseImportCsv("Col1,Col2\nVal1,Val2", { positiveIsIncome: false })).toEqual({
      rows: [],
      errors: [
        "Could not detect columns. The header row needs a date, a description/merchant, and an amount (or debit/credit) column.",
      ],
    });
  });

  it("makeImportId produces consistent SHA-256 ids", () => {
    const row = { date: "2026-07-01", amount: 15.5, merchant: "Target", category: "Shopping" };
    const id1 = makeImportId("acc_123", row, 0);
    const id2 = makeImportId("acc_123", row, 0);
    const id3 = makeImportId("acc_123", row, 1);
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id1.startsWith("import-")).toBe(true);
  });

  it("detectSourceFormat distinguishes formats properly", () => {
    expect(detectSourceFormat("OFXHEADER:100\n<OFX></OFX>")).toBe("ofx");
    expect(
      detectSourceFormat('"Date","Description","Original Description","Amount","Transaction Type"'),
    ).toBe("mint");
    expect(
      detectSourceFormat('"Date","Merchant","Original Statement","Amount"'),
    ).toBe("monarch");
    expect(
      detectSourceFormat('"Date","Payee","Outflow","Inflow"'),
    ).toBe("ynab");
    expect(
      detectSourceFormat('"Date","Description","Amount"'),
    ).toBe("csv");
    expect(detectSourceFormat("")).toBe("csv");
  });

  it("handles ragged short rows in Mint, Monarch, and YNAB CSVs", () => {
    const mintRagged = [
      '"Date","Description","Original Description","Amount","Transaction Type","Category"',
      '"2026-07-01"', // missing description, amount, type
      '"2026-07-01","Store"', // missing amount, type
      '"2026-07-01","Store","Orig","10.00"', // missing type
      '"2026-07-01","Store","Orig","10.00","debit"', // missing category -> category is null
    ].join("\n");
    const mintRes = parseMintCsv(mintRagged);
    expect(mintRes.errors.length).toBeGreaterThan(0);
    expect(mintRes.rows).toHaveLength(1);

    const monarchRagged = [
      '"Date","Merchant","Original Statement","Amount","Category"',
      '"2026-07-01"', // missing merchant, amount
      '"2026-07-01","Store"', // missing amount
      '"2026-07-01","Store","Orig","10.00"', // missing category -> null
    ].join("\n");
    const monarchRes = parseMonarchCsv(monarchRagged);
    expect(monarchRes.errors.length).toBeGreaterThan(0);
    expect(monarchRes.rows).toHaveLength(1);

    const ynabRagged = [
      '"Date","Payee","Memo","Outflow","Inflow","Category"',
      '"2026-07-01"', // missing payee, outflow, inflow
      '"2026-07-01","Store"', // missing outflow, inflow
      '"2026-07-01","Store","Memo","10.00",""', // missing category -> null
    ].join("\n");
    const ynabRes = parseYnabCsv(ynabRagged);
    expect(ynabRes.errors.length).toBeGreaterThan(0);
    expect(ynabRes.rows).toHaveLength(1);

    // YNAB with both combined and bare category columns, where combined is empty
    const ynabDualCat = [
      '"Date","Payee","Outflow","Inflow","Category Group/Category","Category"',
      '"2026-07-01","Store","10.00","","","Shopping"',
    ].join("\n");
    const ynabDualRes = parseYnabCsv(ynabDualCat);
    expect(ynabDualRes.rows[0]?.category).toBe("Shopping");

    // YNAB with invalid and empty dates
    const ynabBadDates = [
      '"Date","Payee","Outflow","Inflow","Category"',
      '"","Store","10.00","","Shopping"', // empty date
      '"not-a-date","Store","10.00","","Shopping"', // invalid date
    ].join("\n");
    const ynabBadDatesRes = parseYnabCsv(ynabBadDates);
    expect(ynabBadDatesRes.errors).toHaveLength(2);

    // Generic parseImportCsv with debit/credit and ragged lines
    const genericDebitCredit = [
      "Transaction Date,Description Text,Debit Amount,Credit Amount,Category Name",
      "2026-07-01,Store", // missing amounts
      "2026-07-01,Store,50.00,", // valid debit
      "2026-07-02,Employer,,2000.00", // valid credit
    ].join("\n");
    const genericRes = parseImportCsv(genericDebitCredit, { positiveIsIncome: false });
    expect(genericRes.rows).toHaveLength(2);
    expect(genericRes.errors.length).toBe(1);
  });
});

