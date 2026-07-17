import { describe, expect, it } from "vitest";
import { generateWeeklyReportPdf } from "@/lib/report-pdf";
import { weeklyReportFixture } from "@/tests/fixtures/weekly-report";

describe("weekly report PDF", () => {
  it("generates a non-trivial PDF document", async () => {
    const buffer = await generateWeeklyReportPdf(weeklyReportFixture());

    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(5_000);
  });

  it("renders zero activity and dense category data without throwing", async () => {
    const zero = await generateWeeklyReportPdf(
      weeklyReportFixture({
        totalSpend: 0,
        previousTotalSpend: 0,
        changeAmount: 0,
        changePercent: null,
        categories: [],
        merchants: [],
        banks: [],
        cards: [],
        budgets: [],
        cashFlow: { inflows: 0, outflows: 0, net: 0 },
      }),
    );
    const dense = await generateWeeklyReportPdf(
      weeklyReportFixture({
        categories: Array.from({ length: 8 }, (_, index) => ({
          category: `CATEGORY_${index + 1}`,
          amount: 100 - index * 8,
          share: (100 - index * 8) / 576,
        })),
      }),
    );

    expect(zero.subarray(0, 4).toString()).toBe("%PDF");
    expect(dense.length).toBeGreaterThan(5_000);
  });

  it("renders positive trend and negative cash flow", async () => {
    const buffer = await generateWeeklyReportPdf(
      weeklyReportFixture({
        totalSpend: 150,
        previousTotalSpend: 100,
        changeAmount: 50,
        changePercent: 50,
        cashFlow: { inflows: 50, outflows: 200, net: -150 },
      }),
    );
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("renders cross-month period, custom card numbers, and zero spend trend", async () => {
    const buffer = await generateWeeklyReportPdf(
      weeklyReportFixture({
        period: {
          start: "2026-06-29",
          end: "2026-07-05",
          previousStart: "2026-06-22",
          previousEnd: "2026-06-28",
        },
        changePercent: 0,
        cards: [{ name: "Chase Checking *1234", amount: 100 }],
      }),
    );
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});
