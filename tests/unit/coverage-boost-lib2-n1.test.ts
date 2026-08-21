import { describe, it, expect } from "vitest";
import {
  parseAmount,
  parseImportCsv,
  parseCsvFormat,
  type CsvFormatSpec,
} from "@/lib/import";
import { parseMintCsv } from "@/lib/import-mint";
import { parseYnabCsv } from "@/lib/import-ynab";
import { parseOfx, looksLikeOfx, isOfxFileName } from "@/lib/import-ofx";

describe("import.ts uncovered branches", () => {
  it("parseAmount returns null for an overflowing magnitude (Infinity)", () => {
    expect(parseAmount("9".repeat(400))).toBeNull();
  });

  it("parseImportCsv amount path flips sign only when positiveIsIncome", () => {
    const csv = "Date,Description,Amount\n2026-07-05,Coffee,4.50\n2026-07-06,Paycheck,1000";
    const { rows } = parseImportCsv(csv, {
      positiveIsIncome: true,
      columns: { date: 0, description: 1, amount: 2, debit: null, credit: null, category: null },
    });
    expect(rows[0]!.amount).toBe(-4.5);
    expect(rows[1]!.amount).toBe(-1000);
  });

  it("parseImportCsv amount path keeps sign when positiveIsIncome is false", () => {
    const csv = "Date,Description,Amount\n2026-07-05,Coffee,4.50\n2026-07-06,Paycheck,-1000";
    const { rows } = parseImportCsv(csv, {
      positiveIsIncome: false,
      columns: { date: 0, description: 1, amount: 2, debit: null, credit: null, category: null },
    });
    expect(rows[0]!.amount).toBe(4.5);
    expect(rows[1]!.amount).toBe(-1000);
  });

  it("parseImportCsv split debit/credit with debit present and credit absent", () => {
    const csv = "Date,Description,Debit,Credit\n2026-07-05,GROCERY,50.25,";
    const { rows } = parseImportCsv(csv, {
      positiveIsIncome: false,
      columns: { date: 0, description: 1, amount: null, debit: 2, credit: 3, category: null },
    });
    expect(rows[0]!.amount).toBe(50.25);
  });

  it("parseImportCsv split debit/credit with debit absent and credit present", () => {
    const csv = "Date,Description,Debit,Credit\n2026-07-05,DEPOSIT,,200.00";
    const { rows } = parseImportCsv(csv, {
      positiveIsIncome: false,
      columns: { date: 0, description: 1, amount: null, debit: 2, credit: 3, category: null },
    });
    expect(rows[0]!.amount).toBe(-200);
  });

  it("parseImportCsv reports an unrecognized amount when the amount cell does not parse", () => {
    const csv = "Date,Description,Amount\n2026-07-05,Coffee,N/A";
    const { rows, errors } = parseImportCsv(csv, {
      positiveIsIncome: false,
      columns: { date: 0, description: 1, amount: 2, debit: null, credit: null, category: null },
    });
    expect(rows).toHaveLength(0);
    expect(errors).toContain("Line 2: unrecognized amount.");
  });

  it("parseImportCsv split columns with both debit and credit blank yields null amount", () => {
    const csv = "Date,Description,Debit,Credit\n2026-07-05,ZERO,0,0";
    const { rows } = parseImportCsv(csv, {
      positiveIsIncome: false,
      columns: { date: 0, description: 1, amount: null, debit: 2, credit: 3, category: null },
    });
    expect(rows[0]!.amount).toBe(0);
  });

  it("parseImportCsv reports an unrecognized date and an empty description", () => {
    const csv = "Date,Description,Amount\nbad-date,MYSTERY,1.00\n2026-07-05,,2.00";
    const { rows, errors } = parseImportCsv(csv, {
      positiveIsIncome: false,
      columns: { date: 0, description: 1, amount: 2, debit: null, credit: null, category: null },
    });
    expect(rows).toHaveLength(0);
    expect(errors).toContain('Line 2: unrecognized date "bad-date".');
    expect(errors).toContain("Line 3: empty description.");
  });

  it("parseCsvFormat without an optional spec", () => {
    const spec: CsvFormatSpec = {
      label: "Custom",
      merchantLabel: "payee",
      required: { date: "date", merchant: "payee", amount: "amount" },
      amount: () => 5,
    };
    const text = "date,payee,amount\n2026-07-05,Shop,5";
    const { rows, errors } = parseCsvFormat(text, spec);
    expect(errors).toHaveLength(0);
    expect(rows[0]!.merchant).toBe("Shop");
  });

  it("parseCsvFormat with an optional category column and missing required columns", () => {
    const spec: CsvFormatSpec = {
      label: "Custom",
      merchantLabel: "payee",
      required: { date: "date", merchant: "payee", amount: "amount" },
      optional: { category: "category" },
      amount: () => 5,
    };
    const ok = parseCsvFormat(
      "date,payee,amount,category\n2026-07-05,Shop,5,Dining",
      spec,
    );
    expect(ok.rows[0]!.category).toBe("Dining");

    const missing = parseCsvFormat("payee,amount\nShop,5", spec);
    expect(missing.errors[0]).toBe("Could not detect Custom columns.");
  });

  it("parseCsvFormat reports unrecognized date and empty merchant for a format", () => {
    const spec: CsvFormatSpec = {
      label: "Custom",
      merchantLabel: "payee",
      required: { date: "date", merchant: "payee", amount: "amount" },
      amount: () => 5,
    };
    const { rows, errors } = parseCsvFormat(
      "date,payee,amount\nbad-date,Shop,5\n2026-07-05,,5",
      spec,
    );
    expect(rows).toHaveLength(0);
    expect(errors).toContain('Line 2: unrecognized date "bad-date".');
    expect(errors).toContain("Line 3: empty payee.");
  });
});

describe("import-mint.ts uncovered branches", () => {
  it("returns null amount when the amount cell does not parse", () => {
    const mint =
      '"Date","Description","Amount","Transaction Type"\n"07/01/2026","Starbucks","not-a-number","debit"';
    const { rows, errors } = parseMintCsv(mint);
    expect(rows).toHaveLength(0);
    expect(errors).toContain("Line 2: unrecognized amount.");
  });

  it("rejects a transaction type that is neither debit nor credit", () => {
    const mint =
      '"Date","Description","Amount","Transaction Type"\n"07/01/2026","Starbucks","5.50","void"';
    const { rows, errors } = parseMintCsv(mint);
    expect(rows).toHaveLength(0);
    expect(errors).toContain("Line 2: unrecognized amount.");
  });

  it("accepts a valid debit row with a category", () => {
    const mint =
      '"Date","Description","Amount","Transaction Type","Category"\n"07/01/2026","Starbucks","5.50","debit","Coffee"';
    const { rows } = parseMintCsv(mint);
    expect(rows[0]).toEqual({
      date: "2026-07-01",
      amount: 5.5,
      merchant: "Starbucks",
      category: "Coffee",
    });
  });
});

describe("import-ynab.ts uncovered branches", () => {
  const header =
    "Account,Flag,Date,Payee,Category Group/Category,Category,Memo,Outflow,Inflow";

  it("prefers the combined category column when present", () => {
    const csv = `${header}\nChecking,,2026-07-01,Starbucks,Restaurants,Coffee,,5.50,`;
    const { rows } = parseYnabCsv(csv);
    expect(rows[0]!.category).toBe("Restaurants");
  });

  it("falls back to the bare category column when the combined column is absent", () => {
    const csv =
      "Account,Flag,Date,Payee,Category,Memo,Outflow,Inflow\nChecking,,2026-07-01,Starbucks,Coffee,,5.50,";
    const { rows } = parseYnabCsv(csv);
    expect(rows[0]!.category).toBe("Coffee");
  });

  it("returns null category when neither category column exists", () => {
    const csv = "Account,Flag,Date,Payee,Memo,Outflow,Inflow\nChecking,,2026-07-01,Starbucks,,5.50,";
    const { rows } = parseYnabCsv(csv);
    expect(rows[0]!.category).toBeNull();
  });
});

describe("import-ofx.ts uncovered branches", () => {
  it("looksLikeOfx sniffs OFX headers and tags", () => {
    expect(looksLikeOfx("OFXHEADER:100")).toBe(true);
    expect(looksLikeOfx("<OFX>")).toBe(true);
    expect(looksLikeOfx("nothing here")).toBe(false);
  });

  it("isOfxFileName matches ofx/qfx extensions case-insensitively", () => {
    expect(isOfxFileName("statement.OFX")).toBe(true);
    expect(isOfxFileName("  transactions.qfx  ")).toBe(true);
    expect(isOfxFileName("report.csv")).toBe(false);
  });

  it("skips a transaction with no DTPOSTED and no TRNAMT", () => {
    const ofx = `
      <STMTTRN>
        <NAME>No date</NAME>
      </STMTTRN>
      <STMTTRN>
        <DTPOSTED>20260705000000</DTPOSTED>
        <NAME>No amount</NAME>
      </STMTTRN>`;
    const rows = parseOfx(ofx);
    expect(rows).toHaveLength(0);
  });

  it("parses valid transactions and combines name and memo", () => {
    const ofx = `
      <STMTTRN>
        <DTPOSTED>20260705000000</DTPOSTED>
        <TRNAMT>-45.60</TRNAMT>
        <NAME>COFFEE</NAME>
        <MEMO>COFFEE</MEMO>
        <FITID>fit-1</FITID>
      </STMTTRN>
      <STMTTRN>
        <DTPOSTED>20260706000000</DTPOSTED>
        <TRNAMT>-10.00</TRNAMT>
        <NAME>STORE</NAME>
        <MEMO>weekly shop</MEMO>
        <FITID>fit-2</FITID>
      </STMTTRN>`;
    const rows = parseOfx(ofx);
    expect(rows[0]).toMatchObject({ date: "2026-07-05", amount: 45.6, fitid: "fit-1", description: "COFFEE" });
    expect(rows[1]).toMatchObject({ date: "2026-07-06", amount: 10, description: "STORE — weekly shop" });
  });

  it("uses memo alone when NAME is absent and decodes entities", () => {
    const ofx = `
      <STMTTRN>
        <DTPOSTED>20260707000000</DTPOSTED>
        <TRNAMT>-5.00</TRNAMT>
        <MEMO>AT&amp;T Bill</MEMO>
      </STMTTRN>`;
    const rows = parseOfx(ofx);
    expect(rows[0]!.description).toBe("AT&T Bill");
    expect(rows[0]!.fitid).toBeNull();
  });

  it("skips a transaction with an implausible date", () => {
    const ofx = `
      <STMTTRN>
        <DTPOSTED>20261301000000</DTPOSTED>
        <TRNAMT>-5.00</TRNAMT>
        <NAME>Bad date</NAME>
      </STMTTRN>`;
    expect(parseOfx(ofx)).toHaveLength(0);
  });
});
