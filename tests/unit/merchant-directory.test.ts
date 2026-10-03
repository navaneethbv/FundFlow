import { describe, expect, it } from "vitest";
import { buildMerchantDirectory } from "@/lib/merchant-directory";

describe("merchant directory", () => {
  it("aggregates outflow by merchant and excludes transfer totals", () => {
    expect(buildMerchantDirectory([
      { id: "1", merchant_name: "Coffee", name: null, amount: 5, date: "2026-01-02", pfc_primary: "FOOD" },
      { id: "2", merchant_name: "Coffee", name: null, amount: -2, date: "2026-01-03", pfc_primary: "FOOD" },
      { id: "3", merchant_name: "Transfer", name: null, amount: 100, date: "2026-01-04", pfc_primary: "TRANSFER_OUT" },
    ])).toEqual([
      { id: "Coffee", merchant: "Coffee", total: 5, count: 2, lastSeen: "2026-01-03", category: "FOOD" },
      { id: "Transfer", merchant: "Transfer", total: 0, count: 1, lastSeen: "2026-01-04", category: null },
    ]);
  });

  it("counts uncategorized outflow without treating it as a transfer", () => {
    expect(buildMerchantDirectory([
      { id: "1", merchant_name: "Unknown shop", name: null, amount: 12, date: "2026-01-02", pfc_primary: null },
    ])).toEqual([
      { id: "Unknown shop", merchant: "Unknown shop", total: 12, count: 1, lastSeen: "2026-01-02", category: null },
    ]);
  });

  it("falls back to the descriptor and preserves the first useful category", () => {
    expect(buildMerchantDirectory([
      { id: "1", merchant_name: null, name: "Cafe", amount: 4, date: "2026-01-02", pfc_primary: null },
      { id: "2", merchant_name: "Cafe", name: "Cafe", amount: 6, date: "2026-01-03", pfc_primary: "FOOD" },
      { id: "3", merchant_name: "", name: "", amount: 1, date: "2026-01-01", pfc_primary: null },
    ])).toEqual([
      { id: "Cafe", merchant: "Cafe", total: 10, count: 2, lastSeen: "2026-01-03", category: "FOOD" },
      { id: "Unknown", merchant: "Unknown", total: 1, count: 1, lastSeen: "2026-01-01", category: null },
    ]);
  });

  it("keeps the latest date and uses alphabetical order for equal totals", () => {
    expect(buildMerchantDirectory([
      { id: "1", merchant_name: "Beta", name: null, amount: 5, date: "2026-01-03", pfc_primary: "FOOD" },
      { id: "2", merchant_name: "Beta", name: null, amount: 1, date: "2026-01-01", pfc_primary: "FOOD" },
      { id: "3", merchant_name: "Alpha", name: null, amount: 6, date: "2026-01-02", pfc_primary: "FOOD" },
    ]).map(({ merchant, total, lastSeen }) => ({ merchant, total, lastSeen }))).toEqual([
      { merchant: "Alpha", total: 6, lastSeen: "2026-01-02" },
      { merchant: "Beta", total: 6, lastSeen: "2026-01-03" },
    ]);
  });

  it("folds saved aliases into their canonical merchant, case-insensitively", () => {
    const aliases = new Map([["old shop", "New Shop"]]);
    expect(buildMerchantDirectory([
      { id: "1", merchant_name: "OLD SHOP", name: null, amount: 4, date: "2026-01-05", pfc_primary: "FOOD" },
      { id: "2", merchant_name: "New Shop", name: null, amount: 6, date: "2026-01-03", pfc_primary: "FOOD" },
    ], aliases)).toEqual([
      { id: "New Shop", merchant: "New Shop", total: 10, count: 2, lastSeen: "2026-01-05", category: "FOOD" },
    ]);
  });
});
