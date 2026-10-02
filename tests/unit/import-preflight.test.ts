import { describe, expect, it } from "vitest";
import { inspectImportCsv } from "@/lib/import-preflight";
import { createImportLayout } from "@/lib/import-profiles";
const header = 'Date,Description,Amount';
const options = { positiveIsIncome: true };
describe("read-only import diagnostics", () => {
  it("reports valid amounts and the selected sign convention without inferring from values", () => {
    const result = inspectImportCsv(`${header}\n2026-01-31,Cafe,-12.50\n2026-02-01,Pay,20`, options);
    expect(result).toMatchObject({ delimiter: "comma", headerRow: 1, totalRows: 2, validRows: 2, canPreview: true, signConvention: "positive_deposits", signBasis: "selected", inflowRows: 1, outflowRows: 1 });
    expect(result.issues).toEqual([]);
  });
  it("reports invalid dates, unsafe numeric formats, and duplicate rows with physical line numbers", () => {
    const result = inspectImportCsv(`${header}\n2026-02-30,Shop,1\n2026-02-01,Shop,"12,50"\n2026-02-02,Shop,2\n2026-02-02,Shop,2`, options);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_date", row: 2 }),
      expect.objectContaining({ code: "amount_format", row: 3 }),
      expect.objectContaining({ code: "duplicate_row", row: 5, relatedRow: 4 }),
    ]));
    expect(result.canPreview).toBe(false);
  });
  it("keeps physical line numbers across blank lines and quoted newlines", () => {
    const result = inspectImportCsv(`${header}\n\n2026-01-01,"Cafe\nWest",1\nbad,Shop,2`, options);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "invalid_date", row: 5 }));
  });
  it.each([[";", "semicolon"], ["\t", "tab"], ["|", "pipe"]])("detects unsupported %s delimiters without changing the import", (separator, delimiter) => {
    const result = inspectImportCsv(`Date${separator}Description${separator}Amount\n2026-01-01${separator}Shop${separator}1`, options);
    expect(result).toMatchObject({ delimiter, canPreview: false });
    expect(result.issues[0]?.code).toBe("delimiter");
  });
  it("identifies the header after a preamble and honors an explicit saved skip count", () => {
    const text = `Statement export\n${header}\n2026-01-01,Shop,1`;
    expect(inspectImportCsv(text, options).issues).toContainEqual(expect.objectContaining({ code: "header_row", row: 2 }));
    const layout = createImportLayout(text, { columns: { date: 0, description: 1, amount: 2, debit: null, credit: null, category: null }, dateOrder: "ymd", positiveIsIncome: true, skipRows: 1 })!;
    expect(inspectImportCsv(text, { ...options, layout })).toMatchObject({ headerRow: 2, canPreview: true, validRows: 1 });
  });
  it("requires explicit date order for ambiguous slash dates", () => {
    const text = `${header}\n01/02/2026,Shop,1`;
    expect(inspectImportCsv(text, options).issues).toContainEqual(expect.objectContaining({ code: "ambiguous_date", row: 2 }));
    const layout = createImportLayout(text, { columns: { date: 0, description: 1, amount: 2, debit: null, credit: null, category: null }, dateOrder: "dmy", positiveIsIncome: false, skipRows: 0 })!;
    expect(inspectImportCsv(text, { ...options, layout })).toMatchObject({ canPreview: true, signConvention: "positive_spend" });
  });
  it("infers split sign convention from mapped debit and credit columns", () => {
    const result = inspectImportCsv('Date,Description,Debit,Credit\n2026-01-01,Shop,5,\n2026-01-02,Refund,,2', options);
    expect(result).toMatchObject({ signConvention: "split", signBasis: "columns", validRows: 2 });
  });
  it("refuses competing debit and credit values instead of ignoring a charge", () => {
    const result = inspectImportCsv('Date,Description,Debit,Credit\n2026-01-01,Shop,5,2', options);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "competing_amounts", row: 2 }));
  });
  it.each(['', header, `${header}\n2026-01-01,"Shop,2`, 'Something,Else\na,b'])("refuses incomplete input %s", text => {
    expect(inspectImportCsv(text, options).canPreview).toBe(false);
  });
  it("rejects unquoted decimal commas that change column count", () => {
    expect(inspectImportCsv(`${header}\n2026-01-01,Shop,12,50`, options).issues).toContainEqual(expect.objectContaining({ code: "row_width", row: 2 }));
  });
  it("honors manual leading rows without requiring a saved layout", () => {
    expect(inspectImportCsv(`Statement\n${header}\n2026-01-01,Shop,1`, { ...options, skipRows: 1 })).toMatchObject({ headerRow: 2, canPreview: true });
  });
  it("handles escaped quotes, grouped amounts, zeroes, and spending-positive signs", () => {
    const report = inspectImportCsv(`${header}\r\n2026-01-01,"Cafe ""West""","$1,234.50"\r\n2026-01-02,Zero,0`, { positiveIsIncome: false });
    expect(report).toMatchObject({ canPreview: true, validRows: 2, outflowRows: 1, inflowRows: 0, signConvention: "positive_spend" });
  });
  it.each([["unknown", "Shop", "invalid_amount"], ["1", "", "invalid_description"], ["1000000000000", "Shop", "amount_range"]])("flags rejected row fields %s", (amount, merchant, code) => {
    expect(inspectImportCsv(`${header}\n2026-01-01,${merchant},${amount}`, options).issues).toContainEqual(expect.objectContaining({ code }));
  });
  it("rejects invalid explicit column maps instead of silently detecting a different map", () => {
    expect(inspectImportCsv(`${header}\n2026-01-01,Shop,1`, { ...options, columns: { date: 99 } }).canPreview).toBe(false);
  });
  it("refuses oversized row sets rather than truncating them", () => {
    const result = inspectImportCsv(`${header}\n` + '2026-01-01,Shop,1\n'.repeat(20_001), options);
    expect(result.issues[0]?.code).toBe("row_limit");
    expect(result.canPreview).toBe(false);
  });
  it("bounds returned diagnostics without ignoring undisplayed errors", () => {
    const result = inspectImportCsv(`${header}\n` + Array.from({ length: 150 }, () => 'bad,Shop,1').join('\n'), options);
    expect(result.issues).toHaveLength(100);
    expect(result).toMatchObject({ issueCount: 150, truncated: true, canPreview: false });
  });
});
