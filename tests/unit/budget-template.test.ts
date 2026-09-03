import { describe, it, expect } from "vitest";
import {
  parseTemplateItems,
  planTemplateApply,
  type BudgetTemplateItem,
} from "@/lib/budget-template";

const ITEM: BudgetTemplateItem = {
  category: "Rent",
  group_name: "fixed",
  planned: 1500,
  rollover_enabled: false,
};

describe("parseTemplateItems", () => {
  it("accepts a valid item list", () => {
    const result = parseTemplateItems([ITEM, { ...ITEM, category: "paycheck", group_name: "income" }]);
    expect(result.ok).toBe(true);
  });

  it("rejects empty, oversized, and malformed payloads", () => {
    expect(parseTemplateItems([]).ok).toBe(false);
    expect(parseTemplateItems("rent:1500").ok).toBe(false);
    expect(parseTemplateItems(new Array(201).fill(ITEM)).ok).toBe(false);
    expect(parseTemplateItems([{ ...ITEM, category: "" }]).ok).toBe(false);
    expect(parseTemplateItems([{ ...ITEM, group_name: "savings" }]).ok).toBe(false);
    expect(parseTemplateItems([{ ...ITEM, planned: -1 }]).ok).toBe(false);
    expect(parseTemplateItems([{ ...ITEM, planned: 1.999 }]).ok).toBe(false);
    expect(parseTemplateItems([{ ...ITEM, rollover_enabled: "yes" }]).ok).toBe(false);
  });
});

describe("planTemplateApply", () => {
  const items: BudgetTemplateItem[] = [
    ITEM,
    { category: "Groceries", group_name: "flexible", planned: 400, rollover_enabled: true },
    { category: "Ghost", group_name: "flexible", planned: 10, rollover_enabled: false },
  ];
  const budgets = [
    { id: "b1", category: "rent" },
    { id: "b2", category: "groceries" },
  ];

  it("maps items to budget rows case-insensitively and reports unmatched", () => {
    const plan = planTemplateApply(items, budgets, []);
    expect(plan.rows).toEqual([
      { budgetId: "b1", planned: 1500 },
      { budgetId: "b2", planned: 400 },
    ]);
    expect(plan.unmatched).toEqual(["Ghost"]);
    expect(plan.conflicts).toBe(0);
  });

  it("merge skips envelopes the target month already has", () => {
    const plan = planTemplateApply(items, budgets, [{ budget_id: "b1" }], "merge");
    expect(plan.rows).toEqual([{ budgetId: "b2", planned: 400 }]);
    expect(plan.skipped).toBe(1);
    expect(plan.conflicts).toBe(1);
  });

  it("overwrite restates every matched envelope", () => {
    const plan = planTemplateApply(items, budgets, [{ budget_id: "b1" }], "overwrite");
    expect(plan.rows).toHaveLength(2);
    expect(plan.skipped).toBe(0);
  });
});
