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
      '"2026-07-01","Jewelry Store","Shopping","Checking","JEWELRY","Anniversary gift","-500.00","luxury,gift"',
    ].join("\n");
    const { rows, errors } = parseMonarchCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({
      date: "2026-07-01",
      amount: 500,
      merchant: "Jewelry Store",
      category: "Shopping",
      sourceAccount: "Checking",
      notes: "Anniversary gift",
      tags: ["luxury", "gift"],
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