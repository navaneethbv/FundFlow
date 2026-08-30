import { describe, it, expect } from "vitest";
import { parseMonarchCsv } from "@/lib/import-monarch";

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
const headerLine = MONARCH_HEADER.map((h) => `"${h}"`).join(",");

describe("Monarch notes and tags import", () => {
  it("reads Notes and Tags alongside the display category and account", () => {
    const csv = [
      headerLine,
      '"2026-07-01","Example Retailer","Shopping","Checking","RETAIL PURCHASE","Imported note","-123.45","tag-one,tag-two"',
    ].join("\n");
    const { rows, errors } = parseMonarchCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({
      date: "2026-07-01",
      amount: 123.45,
      merchant: "Example Retailer",
      category: "Shopping",
      sourceAccount: "Checking",
      notes: "Imported note",
      tags: ["tag-one", "tag-two"],
    });
  });

  it("defaults notes and tags to null when columns are absent", () => {
    const csv = [
      '"Date","Merchant","Category","Amount"',
      '"2026-07-01","Coffee","Dining","-4.50"',
    ].join("\n");
    const { rows, errors } = parseMonarchCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({
      date: "2026-07-01",
      amount: 4.5,
      merchant: "Coffee",
      category: "Dining",
    });
  });
});
