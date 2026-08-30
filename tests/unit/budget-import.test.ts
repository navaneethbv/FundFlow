import { describe, expect, it } from "vitest";
import {
  parseMonarchBudgets,
  buildBudgetImportPlan,
  BUDGET_IMPORT_VERSION,
} from "@/lib/budget-import";

const MONARCH_JSON = JSON.stringify({
  groups: [
    { name: "Needs", type: "fixed", categories: [{ name: "Rent", amount: 2000 }] },
    {
      name: "Lifestyle",
      type: "flexible",
      categories: [{ name: "Shopping", amount: 400 }, { name: "Dining", amount: 300 }],
    },
    { name: "Annual", type: "non_monthly", categories: [{ name: "Insurance", amount: 1200 }] },
    { name: "Income", type: "income", categories: [{ name: "Salary", amount: 8000 }] },
  ],
});

describe("parseMonarchBudgets", () => {
  it("maps Monarch groups to the versioned provider-neutral model", () => {
    const { rows, errors } = parseMonarchBudgets(MONARCH_JSON);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { category: "Rent", monthlyAmount: 2000, group: "fixed", groupName: null },
      { category: "Shopping", monthlyAmount: 400, group: "flexible", groupName: null },
      { category: "Dining", monthlyAmount: 300, group: "flexible", groupName: null },
      { category: "Insurance", monthlyAmount: 1200, group: "non_monthly", groupName: null },
      { category: "Salary", monthlyAmount: 8000, group: "income", groupName: null },
    ]);
  });

  it("preserves unknown group names as a custom group", () => {
    const { rows } = parseMonarchBudgets(
      JSON.stringify({ groups: [{ name: "Custom", type: "weird", categories: [{ name: "X", amount: 10 }] }] }),
    );
    expect(rows[0]).toMatchObject({ group: "custom", groupName: "Custom" });
  });

  it("reports malformed input instead of throwing", () => {
    const { rows, errors } = parseMonarchBudgets("not json");
    expect(rows).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("buildBudgetImportPlan", () => {
  it("surfaces conflicts and unbudgeted categories", () => {
    const plan = buildBudgetImportPlan(
      parseMonarchBudgets(MONARCH_JSON).rows,
      [
        { category: "Rent", monthly_limit: 1500, group_name: "fixed" },
        { category: "Streaming", monthly_limit: 20, group_name: "flexible" },
      ],
    );
    expect(plan.conflicts).toEqual([
      { category: "Rent", existingAmount: 1500, incomingAmount: 2000 },
    ]);
    // Streaming exists in FundFlow but not in the Monarch export.
    expect(plan.unbudgetedCategories).toEqual(["Streaming"]);
  });

  it("is deterministic and versioned", () => {
    const plan = buildBudgetImportPlan(parseMonarchBudgets(MONARCH_JSON).rows, []);
    expect(plan.version).toBe(BUDGET_IMPORT_VERSION);
    expect(plan.rows).toHaveLength(5);
  });
});
describe("budget import edge coverage", () => {
  it("reports a group with no usable categories and a non-array input", () => {
    const noCategories = parseMonarchBudgets(
      JSON.stringify({ groups: [{ name: "Needs", type: "fixed", categories: "oops" }] }),
    );
    expect(noCategories.rows).toEqual([]);

    const noGroups = parseMonarchBudgets(JSON.stringify({ foo: 1 }));
    expect(noGroups.rows).toEqual([]);
    expect(noGroups.errors.length).toBeGreaterThan(0);
  });

  it("keeps a category with no matching existing budget out of unbudgeted", () => {
    const plan = buildBudgetImportPlan(
      parseMonarchBudgets(MONARCH_JSON).rows,
      [{ category: "Rent", monthly_limit: 2000, group_name: "fixed" }],
    );
    expect(plan.unbudgetedCategories).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });
});
