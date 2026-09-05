import { describe, it, expect } from "vitest";
import { generateAiInsightSummaries } from "@/lib/ai-insights";

describe("generateAiInsightSummaries", () => {
  it("returns empty array when enabled is false", () => {
    expect(generateAiInsightSummaries({ enabled: false, rows: [] })).toEqual([]);
  });

  it("calculates spending, income, and top category summaries with fallbacks", () => {
    const summaries = generateAiInsightSummaries({
      enabled: true,
      rows: [
        { month: "2026-07", amount: 150, category: "FOOD_AND_DRINK" },
        { month: "2026-07", amount: 50, category: null },
        { month: "2026-07", amount: -2000, category: "INCOME" },
      ],
    });

    expect(summaries).toHaveLength(4);
    expect(summaries[0]!.sourceMonth).toBe("2026-07");
    expect(summaries[0]!.summary).toContain("200 in tracked spending against 2000 in income");
    expect(summaries[1]!.summary).toContain("FOOD_AND_DRINK");
  });

  it("handles empty rows or rows without positive spending", () => {
    const summaries = generateAiInsightSummaries({
      enabled: true,
      rows: [{ amount: -500 }],
    });

    expect(summaries[0]!.sourceMonth).toBeNull();
    expect(summaries[1]!.summary).toContain("spending");
  });

  it("uses canonical flow to keep transfers out of the spending total", () => {
    const summaries = generateAiInsightSummaries({
      enabled: true,
      rows: [
        { month: "2026-07", amount: 500, category: "Rent", flow: "transfer" },
        { month: "2026-07", amount: 80, category: "Food", flow: "expense" },
      ],
    });
    expect(summaries[0]!.summary).toContain("80 in tracked spending");
    expect(summaries[0]!.summary).not.toContain("580");
  });
});
