import { describe, expect, it } from "vitest";
import { buildWeeklyReportModel } from "@/lib/weekly-report";

const period = {
  start: "2026-07-06",
  end: "2026-07-12",
  previousStart: "2026-06-29",
  previousEnd: "2026-07-05",
};

const accounts = [
  {
    id: "checking",
    name: "Everyday Checking",
    type: "depository",
    plaidItemId: "chase-item",
  },
  {
    id: "sapphire",
    name: "Sapphire Reserve",
    type: "credit",
    plaidItemId: "chase-item",
  },
  {
    id: "gold",
    name: "Gold Card",
    type: "credit",
    plaidItemId: "amex-item",
  },
];

const transactions = [
  {
    id: "previous-food",
    date: "2026-07-01",
    amount: 100,
    merchantName: "Cafe",
    name: "CAFE",
    category: "FOOD_AND_DRINK",
    accountId: "sapphire",
  },
  {
    id: "meal",
    date: "2026-07-08",
    amount: 120,
    merchantName: "RAW CAFE 123",
    name: "RAW CAFE 123",
    category: "FOOD_AND_DRINK",
    accountId: "sapphire",
  },
  {
    id: "fuel",
    date: "2026-07-09",
    amount: 60,
    merchantName: "Shell",
    name: "SHELL",
    category: "TRANSPORTATION",
    accountId: "checking",
  },
  {
    id: "travel",
    date: "2026-07-10",
    amount: 30,
    merchantName: "Airline",
    name: "AIRLINE",
    category: "TRAVEL",
    accountId: "gold",
  },
  {
    id: "refunded-charge",
    date: "2026-07-07",
    amount: 40,
    merchantName: "Store",
    name: "STORE",
    category: "GENERAL_MERCHANDISE",
    accountId: "sapphire",
  },
  {
    id: "refund",
    date: "2026-07-11",
    amount: -40,
    merchantName: "Store",
    name: "STORE",
    category: "GENERAL_MERCHANDISE",
    accountId: "sapphire",
  },
  {
    id: "confirmed-duplicate",
    date: "2026-07-09",
    amount: 60,
    merchantName: "Shell",
    name: "SHELL",
    category: "TRANSPORTATION",
    accountId: "checking",
  },
  {
    id: "transfer",
    date: "2026-07-10",
    amount: 300,
    merchantName: "Credit card payment",
    name: "PAYMENT",
    category: "TRANSFER_OUT",
    accountId: "checking",
  },
  {
    id: "paycheck",
    date: "2026-07-11",
    amount: -500,
    merchantName: "Employer",
    name: "PAYROLL",
    category: "INCOME",
    accountId: "checking",
  },
];

describe("weekly report model", () => {
  it("reconciles spend with dashboard categorization rules", () => {
    const report = buildWeeklyReportModel({
      userId: "user-1",
      userEmail: "person@example.com",
      period,
      transactions,
      accounts,
      institutions: [
        { id: "chase-item", name: "Chase" },
        { id: "amex-item", name: "American Express" },
      ],
      budgets: [{ category: "DINING", monthlyLimit: 1000 }],
      merchantRules: [
        {
          matchType: "keyword",
          pattern: "RAW CAFE",
          displayName: "Cafe",
          category: "DINING",
          enabled: true,
        },
        {
          matchType: "keyword",
          pattern: "RAW CAFE",
          displayName: "Wrong second match",
          category: "OTHER",
          enabled: true,
        },
      ],
      splits: [
        { transactionId: "meal", category: "DINING", amount: 90 },
        { transactionId: "meal", category: "GIFTS", amount: 30 },
      ],
      linkedRefundTransactionIds: new Set(["refunded-charge", "refund"]),
      duplicateTransactionIds: new Set(["confirmed-duplicate"]),
    });

    expect(report.totalSpend).toBe(210);
    expect(report.previousTotalSpend).toBe(100);
    expect(report.changeAmount).toBe(110);
    expect(report.changePercent).toBe(1.1);
    expect(report.categories).toEqual([
      { category: "DINING", amount: 90, share: 0.4286 },
      { category: "TRANSPORTATION", amount: 60, share: 0.2857 },
      { category: "GIFTS", amount: 30, share: 0.1429 },
      { category: "TRAVEL", amount: 30, share: 0.1429 },
    ]);
    expect(report.merchants[0]).toEqual({ merchant: "Cafe", amount: 120 });
    expect(report.banks).toEqual([
      { name: "Chase", amount: 180 },
      { name: "American Express", amount: 30 },
    ]);
    expect(report.cards).toEqual([
      { name: "Sapphire Reserve", amount: 120 },
      { name: "Gold Card", amount: 30 },
    ]);
    expect(report.cards.map((card) => card.name).join(" ")).not.toMatch(
      /\d{4}/,
    );
    expect(report.budgets).toEqual([
      {
        category: "DINING",
        spent: 90,
        weeklyAllowance: 230.77,
        percentage: 0.39,
        status: "on-track",
      },
    ]);
    expect(report.cashFlow).toEqual({ inflows: 500, outflows: 360, net: 140 });
  });

  it("uses null change percentage when the previous week has no spend", () => {
    const report = buildWeeklyReportModel({
      userId: "user-1",
      userEmail: "person@example.com",
      period,
      transactions: [],
      accounts,
      institutions: [],
      budgets: [],
      merchantRules: [],
      splits: [],
      linkedRefundTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
    });

    expect(report.totalSpend).toBe(0);
    expect(report.previousTotalSpend).toBe(0);
    expect(report.changePercent).toBeNull();
    expect(report.categories).toEqual([]);
  });
});
