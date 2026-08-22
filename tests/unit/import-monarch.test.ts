import { describe, it, expect } from "vitest";
import { looksLikeMonarchCsv, parseMonarchCsv } from "@/lib/import-monarch";

const MONARCH_HEADER = [
  "Date",
  "Merchant",
  "Category",
  "Account",
  "Original Statement",
  "Notes",
  "Amount",
  "Tags",
];

describe("looksLikeMonarchCsv", () => {
  it("returns true for a header with Merchant and Original Statement", () => {
    expect(looksLikeMonarchCsv(MONARCH_HEADER)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(looksLikeMonarchCsv(["date", "merchant", "category", "account", "original statement", "notes", "amount", "tags"])).toBe(true);
  });

  it("requires the Original Statement pairing, not just Merchant alone", () => {
    expect(looksLikeMonarchCsv(["Date", "Merchant", "Amount"])).toBe(false);
  });

  it("returns false for Mint, YNAB, and plain bank headers", () => {
    expect(looksLikeMonarchCsv(["Date", "Description", "Original Description", "Amount", "Transaction Type", "Category", "Account Name", "Labels", "Notes"])).toBe(false);
    expect(looksLikeMonarchCsv(["Account", "Flag", "Date", "Payee", "Category Group/Category", "Category Group", "Category", "Memo", "Outflow", "Inflow", "Cleared"])).toBe(false);
    expect(looksLikeMonarchCsv(["Date", "Description", "Amount"])).toBe(false);
  });
});

describe("parseMonarchCsv", () => {
  const headerLine = MONARCH_HEADER.map((h) => `"${h}"`).join(",");

  it("negates Amount (Monarch expense = negative -> Plaid money-out = positive)", () => {
    const csv = [
      headerLine,
      '"2026-07-01","Starbucks","Coffee","Checking","STARBUCKS 123","","-5.50",""',
      '"2026-07-02","Paycheck","Income","Checking","ACME CORP","","1000.00",""',
    ].join("\n");
    const { rows, errors } = parseMonarchCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ date: "2026-07-01", amount: 5.5, merchant: "Starbucks", category: "Coffee", sourceAccount: "Checking" });
    expect(rows[1]!.amount).toBe(-1000);
  });

  it("maps Merchant to merchant and Category to category", () => {
    const csv = [
      headerLine,
      '"2026-07-01","Coffee Bar","Dining","Checking","SQ *COFFEE BAR","","-4.50",""',
    ].join("\n");
    const { rows, errors } = parseMonarchCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ date: "2026-07-01", amount: 4.5, merchant: "Coffee Bar", category: "Dining", sourceAccount: "Checking" });
  });

  it("reports an unparseable date or amount with a 1-based line number", () => {
    const csv = [
      headerLine,
      '"not-a-date","Store","","Checking","","","-5.00",""',
      '"2026-07-02","Store2","","Checking","","","N/A",""',
    ].join("\n");
    const { rows, errors } = parseMonarchCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Line 2");
    expect(errors[1]).toContain("Line 3");
  });
});
