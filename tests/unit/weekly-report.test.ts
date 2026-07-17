import { describe, expect, it } from "vitest";
import { buildWeeklyReportModel, formatCardLabel } from "@/lib/weekly-report";

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
      { name: "Chase · Sapphire Reserve", amount: 120 },
      { name: "American Express · Gold Card", amount: 30 },
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

describe("formatCardLabel", () => {
  it("title-cases a name Plaid returns in all caps", () => {
    // The real failure: Chase reports this account as "CREDIT CARD", which read
    // as a shouted, bank-less row for the largest card total on the page.
    expect(formatCardLabel("CREDIT CARD", "Chase")).toBe("Chase · Credit Card");
  });

  it("leaves a name that already has its own casing alone", () => {
    expect(formatCardLabel("Platinum Card®", "American Express")).toBe(
      "American Express · Platinum Card®",
    );
    expect(formatCardLabel("Blue Cash Preferred®", "American Express")).toBe(
      "American Express · Blue Cash Preferred®",
    );
    expect(formatCardLabel("Amazon", "Chase")).toBe("Chase · Amazon");
  });

  it("falls back when the institution or the name is missing", () => {
    expect(formatCardLabel("Freedom", null)).toBe("Freedom");
    expect(formatCardLabel("   ", "Chase")).toBe("Chase · Credit card");
    expect(formatCardLabel(null, "Chase")).toBe("Chase · Credit card");
    expect(formatCardLabel(null, null)).toBe("Credit card");
  });
});

describe("weekly report model budget sorting", () => {
  it("sorts budgets by percentage descending, and then by category alphabetically when percentages are equal", () => {
    const report = buildWeeklyReportModel({
      userId: "user-1",
      userEmail: "person@example.com",
      period: {
        start: "2026-07-06",
        end: "2026-07-12",
        previousStart: "2026-06-29",
        previousEnd: "2026-07-05",
      },
      transactions: [],
      accounts: [],
      institutions: [],
      budgets: [
        { category: "TRAVEL", monthlyLimit: 520 },
        { category: "DINING", monthlyLimit: 520 },
        { category: "AUTO", monthlyLimit: 520 },
      ],
      merchantRules: [],
      splits: [],
      linkedRefundTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
    });

    expect(report.budgets.map((b) => b.category)).toEqual(["AUTO", "DINING", "TRAVEL"]);
  });
});

describe("weekly report model edge cases and branch coverage", () => {
  it("covers missing accounts, missing institutions, merchant tie-breakers, and budget statuses", () => {
    const report = buildWeeklyReportModel({
      userId: "user-1",
      userEmail: "person@example.com",
      period: {
        start: "2026-07-06",
        end: "2026-07-12",
        previousStart: "2026-06-29",
        previousEnd: "2026-07-05",
      },
      transactions: [
        {
          id: "t1",
          date: "2026-07-08",
          amount: 100,
          merchantName: "Merchant B",
          name: "Merchant B",
          category: "FOOD",
          accountId: "missing-account", // account is missing in accounts list
        },
        {
          id: "t2",
          date: "2026-07-08",
          amount: 100,
          merchantName: "Merchant A", // same amount as Merchant B to trigger tie-breaker
          name: "Merchant A",
          category: "TRAVEL",
          accountId: "no-inst-account", // account exists, but institution name is missing
        },
        {
          id: "t3",
          date: "2026-07-08",
          amount: 100,
          merchantName: "Merchant C",
          name: "Merchant C",
          category: "CREDIT_SPEND",
          accountId: "missing-credit-account", // credit spending with missing account
        },
      ],
      accounts: [
        {
          id: "no-inst-account",
          name: "Anonymous checking",
          type: "depository",
          plaidItemId: "unknown-item",
        },
        {
          id: "missing-credit-account",
          name: "Anonymous credit",
          type: "credit",
          plaidItemId: "unknown-item",
        },
      ],
      institutions: [], // no institutions mocked
      budgets: [
        { category: "FOOD", monthlyLimit: 0 }, // allowance: 0, spent: 100 -> percentage: 1 (spent > 0), status: "at-risk" (percentage >= 0.85)
        { category: "TRAVEL", monthlyLimit: 520 }, // allowance: 120, spent: 100 -> percentage: 0.83, status: "on-track"
        { category: "AUTO", monthlyLimit: 0 }, // allowance: 0, spent: 0 -> percentage: 0, status: "on-track"
        { category: "OVER_BUDGET", monthlyLimit: 520 }, // allowance: 120, spent: 150 -> percentage: 1.25, status: "over"
        { category: "AT_RISK_BUDGET", monthlyLimit: 520 }, // allowance: 120, spent: 108 -> percentage: 0.9, status: "at-risk"
      ],
      merchantRules: [],
      splits: [],
      linkedRefundTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
    });

    expect(report.banks).toEqual([{ name: "Other bank", amount: 300 }]);
    expect(report.merchants).toEqual([
      { merchant: "Merchant A", amount: 100 },
      { merchant: "Merchant B", amount: 100 },
      { merchant: "Merchant C", amount: 100 },
    ]);
  });
});
