import type { WeeklyReportData } from "@/lib/weekly-report";

export function weeklyReportFixture(
  overrides: Partial<WeeklyReportData> = {},
): WeeklyReportData {
  return {
    userId: "user-1",
    userEmail: "person@example.com",
    period: {
      start: "2026-07-06",
      end: "2026-07-12",
      previousStart: "2026-06-29",
      previousEnd: "2026-07-05",
    },
    totalSpend: 842.35,
    previousTotalSpend: 910.25,
    changeAmount: -67.9,
    changePercent: -0.0746,
    categories: [
      { category: "FOOD_AND_DRINK", amount: 286.4, share: 0.34 },
      { category: "TRANSPORTATION", amount: 202.16, share: 0.24 },
      { category: "TRAVEL", amount: 151.62, share: 0.18 },
      { category: "GENERAL_MERCHANDISE", amount: 117.93, share: 0.14 },
      { category: "ENTERTAINMENT", amount: 84.24, share: 0.1 },
    ],
    merchants: [
      { merchant: "Whole Foods", amount: 164.2 },
      { merchant: "United Airlines", amount: 151.62 },
      { merchant: "Shell", amount: 92.44 },
      { merchant: "Neighborhood Cafe", amount: 76.15 },
    ],
    banks: [
      { name: "Chase", amount: 506.81 },
      { name: "American Express", amount: 252.71 },
      { name: "Wells Fargo", amount: 82.83 },
    ],
    cards: [
      { name: "Sapphire Reserve", amount: 303.25 },
      { name: "Gold Card", amount: 252.71 },
      { name: "Freedom Unlimited", amount: 126.7 },
    ],
    budgets: [
      {
        category: "FOOD_AND_DRINK",
        spent: 286.4,
        weeklyAllowance: 276.92,
        percentage: 1.03,
        status: "over",
      },
      {
        category: "TRANSPORTATION",
        spent: 202.16,
        weeklyAllowance: 230.77,
        percentage: 0.88,
        status: "at-risk",
      },
      {
        category: "ENTERTAINMENT",
        spent: 84.24,
        weeklyAllowance: 115.38,
        percentage: 0.73,
        status: "on-track",
      },
    ],
    cashFlow: { inflows: 2450, outflows: 1687.42, net: 762.58 },
    ...overrides,
  };
}
