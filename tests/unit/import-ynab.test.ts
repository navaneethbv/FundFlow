import { describe, it, expect } from "vitest";
import { looksLikeYnabCsv, parseYnabCsv } from "@/lib/import-ynab";

const YNAB_HEADER = [
  "Account",
  "Flag",
  "Date",
  "Payee",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Memo",
  "Outflow",
  "Inflow",
  "Cleared",
];

describe("looksLikeYnabCsv", () => {
  it("returns true for a header with Payee, Outflow, and Inflow", () => {
    expect(looksLikeYnabCsv(YNAB_HEADER)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(looksLikeYnabCsv(["account", "flag", "date", "payee", "category group/category", "category group", "category", "memo", "outflow", "inflow", "cleared"])).toBe(true);
  });

  it("returns false without the Payee column, and for Mint/Monarch/bank headers", () => {
    expect(looksLikeYnabCsv(["Account", "Flag", "Date", "Memo", "Outflow", "Inflow", "Cleared"])).toBe(false);
    expect(looksLikeYnabCsv(["Date", "Description", "Original Description", "Amount", "Transaction Type", "Category", "Account Name", "Labels", "Notes"])).toBe(false);
    expect(looksLikeYnabCsv(["Date", "Merchant", "Category", "Account", "Original Statement", "Notes", "Amount", "Tags"])).toBe(false);
    expect(looksLikeYnabCsv(["Date", "Description", "Amount"])).toBe(false);
  });
});

describe("parseYnabCsv", () => {
  const headerLine = YNAB_HEADER.map((h) => `"${h}"`).join(",");

  it("treats a nonzero Outflow as positive (money-out) and a nonzero Inflow as negative (money-in)", () => {
    const csv = [
      headerLine,
      '"Checking","","2026-07-01","Starbucks","Restaurants","Restaurants","Starbucks","","5.50","","Cleared"',
      '"Checking","","2026-07-02","ACME Corp","Income","Income","Salary","","","1,000.00","Cleared"',
    ].join("\n");
    const { rows, errors } = parseYnabCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ date: "2026-07-01", amount: 5.5, merchant: "Starbucks", category: "Restaurants" });
    expect(rows[1]!.amount).toBe(-1000);
  });

  it("uses Category Group/Category when present, falling back to bare Category", () => {
    const withCombined = [
      headerLine,
      '"Checking","","2026-07-01","Coffee Bar","Dining","Dining","Coffee","","-4.50","","Cleared"',
    ].join("\n");
    const combined = parseYnabCsv(withCombined);
    expect(combined.rows[0]!.category).toBe("Dining");

    // A header without the combined column falls back to bare Category.
    const headerNoCombined = [
      "Account", "Flag", "Date", "Payee", "Category", "Memo", "Outflow", "Inflow", "Cleared",
    ];
    const noCombinedCsv = [
      headerNoCombined.map((h) => `"${h}"`).join(","),
      '"Checking","","2026-07-01","Coffee Bar","Coffee","","4.50","","Cleared"',
    ].join("\n");
    const noCombined = parseYnabCsv(noCombinedCsv);
    expect(noCombined.rows[0]!.category).toBe("Coffee");
  });

  it("handles thousands separators with no currency symbol", () => {
    const csv = [
      headerLine,
      '"Checking","","2026-07-01","Rent","Housing","Housing","Rent","","1,234.56","","Cleared"',
    ].join("\n");
    const { rows, errors } = parseYnabCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]!.amount).toBe(1234.56);
  });

  it("reports malformed rows with a 1-based line number", () => {
    const csv = [
      headerLine,
      '"Checking","","not-a-date","Store","","","","","5.00","","Cleared"',
      '"Checking","","2026-07-02","Store2","","","","","N/A","","Cleared"',
    ].join("\n");
    const { rows, errors } = parseYnabCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Line 2");
    expect(errors[1]).toContain("Line 3");
  });
});
