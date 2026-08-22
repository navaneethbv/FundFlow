import { describe, it, expect } from "vitest";
import { looksLikeMintCsv, parseMintCsv } from "@/lib/import-mint";

const MINT_HEADER = [
  "Date",
  "Description",
  "Original Description",
  "Amount",
  "Transaction Type",
  "Category",
  "Account Name",
  "Labels",
  "Notes",
];

describe("looksLikeMintCsv", () => {
  it("returns true for a header with Transaction Type and Original Description", () => {
    expect(looksLikeMintCsv(MINT_HEADER)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(looksLikeMintCsv(["date", "description", "original description", "amount", "transaction type", "category", "account name", "labels", "notes"])).toBe(true);
  });

  it("returns false for a plain bank CSV header", () => {
    expect(looksLikeMintCsv(["Date", "Description", "Amount"])).toBe(false);
  });

  it("returns false for a Monarch header", () => {
    expect(looksLikeMintCsv(["Date", "Merchant", "Category", "Account", "Original Statement", "Notes", "Amount", "Tags"])).toBe(false);
  });

  it("returns false for a YNAB header", () => {
    expect(looksLikeMintCsv(["Account", "Flag", "Date", "Payee", "Category Group/Category", "Category Group", "Category", "Memo", "Outflow", "Inflow", "Cleared"])).toBe(false);
  });
});

describe("parseMintCsv", () => {
  const headerLine = MINT_HEADER.map((h) => `"${h}"`).join(",");

  it("maps debit to positive amount and credit to negative, regardless of raw Amount sign", () => {
    const csv = [
      headerLine,
      '"07/01/2026","Starbucks","STARBUCKS 123","5.50","debit","Coffee","Checking","",""',
      '"07/02/2026","Paycheck","ACME CORP","1000.00","credit","Income","Checking","",""',
      '"07/03/2026","Refund","REFUND CO","-12.00","debit","Shopping","Checking","",""',
    ].join("\n");
    const { rows, errors } = parseMintCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ date: "2026-07-01", amount: 5.5, merchant: "Starbucks", category: "Coffee", sourceAccount: "Checking" });
    expect(rows[1]!.amount).toBe(-1000);
    // A debit whose raw Amount is negative is still money-out (positive in Plaid).
    expect(rows[2]!.amount).toBe(12);
  });

  it("uses Description (not Original Description) as merchant and Category as category", () => {
    const csv = [
      headerLine,
      '"07/01/2026","Coffee Bar","SQ *COFFEE BAR","4.50","debit","Dining","Checking","",""',
    ].join("\n");
    const { rows, errors } = parseMintCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ date: "2026-07-01", amount: 4.5, merchant: "Coffee Bar", category: "Dining", sourceAccount: "Checking" });
  });

  it("reports malformed rows with a 1-based line number, never silently dropping them", () => {
    const csv = [
      headerLine,
      '"not-a-date","Store","STORE","5.00","debit","","Checking","",""',
      '"07/02/2026","BadType","BADTYPE","5.00","unknown","","Checking","",""',
      '"07/03/2026","BadAmount","BADAMT","N/A","debit","","Checking","",""',
      '"07/04/2026","Store","STORE","5.00","debit","","Checking","",""',
    ].join("\n");
    const { rows, errors } = parseMintCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe("2026-07-04");
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("Line 2");
    expect(errors[1]).toContain("Line 3");
    expect(errors[2]).toContain("Line 4");
  });
});
