import { describe, expect, it } from "vitest";
import { buildSetupItems, initialSetupRows, rowsForStep, summarizeSetup } from "@/lib/budget-setup";
import type { BudgetSeedProposal } from "@/lib/budget-page";

function proposal(category: string, group_name: BudgetSeedProposal["group_name"], amount: number): BudgetSeedProposal {
  return { category, group_name, suggested_amount: amount, rollover_enabled: false, sort_order: 0, confidence: "high", reason: "test" };
}

const proposals = [
  proposal("INCOME_WAGES", "income", 5000),
  proposal("RENT", "fixed", 2000),
  proposal("FOOD_AND_DRINK", "flexible", 600),
  proposal("TRAVEL", "non_monthly", 150),
];

describe("budget setup wizard", () => {
  it("walks proposals group by group, folding non-monthly into flexible", () => {
    const rows = initialSetupRows(proposals);
    expect(rowsForStep(rows, "income").map((row) => row.category)).toEqual(["INCOME_WAGES"]);
    expect(rowsForStep(rows, "fixed").map((row) => row.category)).toEqual(["RENT"]);
    expect(rowsForStep(rows, "flexible").map((row) => row.category)).toEqual(["FOOD_AND_DRINK", "TRAVEL"]);
    rows[1]!.included = false;
    expect(rowsForStep(rows, "review").map((row) => row.category)).toEqual(["INCOME_WAGES", "FOOD_AND_DRINK", "TRAVEL"]);
  });

  it("builds the POST /api/budget items from edited, included rows", () => {
    const rows = initialSetupRows(proposals);
    rows[2]!.amountText = "550.50";
    rows[3]!.included = false;
    expect(buildSetupItems(rows)).toEqual({ items: [
      { category: "INCOME_WAGES", monthly_limit: 5000, group_name: "income", rollover_enabled: false, sort_order: 0 },
      { category: "RENT", monthly_limit: 2000, group_name: "fixed", rollover_enabled: false, sort_order: 0 },
      { category: "FOOD_AND_DRINK", monthly_limit: 550.5, group_name: "flexible", rollover_enabled: false, sort_order: 0 },
    ] });
  });

  it("refuses an empty selection or an invalid amount instead of saving zero", () => {
    const rows = initialSetupRows(proposals);
    expect(buildSetupItems(rows.map((row) => ({ ...row, included: false })))).toEqual({ error: "Select at least one category." });
    rows[1]!.amountText = "12.345";
    expect(buildSetupItems(rows)).toEqual({ error: "Enter a valid amount for RENT." });
    rows[1]!.amountText = "";
    expect(buildSetupItems(rows)).toEqual({ error: "Enter a valid amount for RENT." });
  });

  it("reviews the draft against its planned income", () => {
    const rows = initialSetupRows(proposals);
    expect(summarizeSetup(rows)).toMatchObject({ status: "within", expectedIncome: 5000, allocated: 2750 });
    rows[1]!.amountText = "4500";
    expect(summarizeSetup(rows)).toMatchObject({ status: "over", overBy: 250 });
    rows[0]!.included = false;
    expect(summarizeSetup(rows).status).toBe("no_income");
  });
});
