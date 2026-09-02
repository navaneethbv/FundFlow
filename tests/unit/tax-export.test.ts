import { describe, it, expect } from "vitest";
import { buildTaxExport } from "@/lib/tax-export";
import { TAX_FALLBACK_LINE_ITEM } from "@/lib/tax-categories";

describe("buildTaxExport", () => {
  const tags = new Map<string, readonly string[]>([
    ["t1", ["charity"]],
    ["t2", ["tax"]],
    ["t3", ["vacation"]],
  ]);

  const txns = [
    {
      sourceTransactionId: "t2",
      date: "2026-02-01",
      merchant: "Corner Shop",
      signedAmount: 12.5,
    },
    {
      sourceTransactionId: "t1",
      date: "2026-01-15",
      merchant: "Food Bank",
      signedAmount: 100,
    },
    {
      sourceTransactionId: "t3",
      date: "2026-03-01",
      merchant: "Airline",
      signedAmount: 400,
    },
  ];

  it("exports only tax-tagged rows with their line item, date-sorted", () => {
    const { rows, summary } = buildTaxExport(txns, tags);
    expect(rows).toEqual([
      { date: "2026-01-15", merchant: "Food Bank", amount: 100, category: "Charitable donations" },
      {
        date: "2026-02-01",
        merchant: "Corner Shop",
        amount: 12.5,
        category: TAX_FALLBACK_LINE_ITEM,
      },
    ]);
    expect(summary).toEqual([
      { lineItem: "Charitable donations", count: 1, total: 100 },
      { lineItem: TAX_FALLBACK_LINE_ITEM, count: 1, total: 12.5 },
    ]);
  });

  it("is split-safe: parts inherit the parent's line item and sum once", () => {
    // A split parent arrives as two projected rows sharing sourceTransactionId,
    // each carrying its own signed amount; together they equal the transaction.
    const splitTxns = [
      {
        sourceTransactionId: "s1",
        date: "2026-04-02",
        merchant: "Warehouse Club",
        signedAmount: 60,
      },
      {
        sourceTransactionId: "s1",
        date: "2026-04-02",
        merchant: "Warehouse Club",
        signedAmount: 40,
      },
    ];
    const { rows, summary } = buildTaxExport(splitTxns, new Map([["s1", ["donations"]]]));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.category === "Charitable donations")).toBe(true);
    expect(summary).toEqual([{ lineItem: "Charitable donations", count: 2, total: 100 }]);
  });

  it("falls back to Unknown for blank merchants and rounds summary totals", () => {
    const { rows, summary } = buildTaxExport(
      [{ sourceTransactionId: "t4", date: "2026-05-01", merchant: "", signedAmount: 100.125 }],
      new Map([["t4", ["mortgage interest"]]]),
    );
    expect(rows[0].merchant).toBe("Unknown");
    expect(summary[0].total).toBe(100.13);
  });

  it("orders summary lines in curated declaration order, then the fallback", () => {
    const { summary } = buildTaxExport(
      [
        { sourceTransactionId: "a", date: "2026-01-01", merchant: "X", signedAmount: 1 },
        { sourceTransactionId: "b", date: "2026-01-02", merchant: "Y", signedAmount: 2 },
        { sourceTransactionId: "c", date: "2026-01-03", merchant: "Z", signedAmount: 3 },
      ],
      new Map([
        ["c", ["tax"]],
        ["a", ["mortgage interest"]],
        ["b", ["401k"]],
      ]),
    );
    expect(summary.map((line) => line.lineItem)).toEqual([
      "Mortgage interest",
      "Retirement contributions",
      TAX_FALLBACK_LINE_ITEM,
    ]);
  });
});
