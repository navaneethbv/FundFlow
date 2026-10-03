/**
 * Reference adoption 7.2: compare what the month's budget allocates against
 * the income the user budgeted for it. Expected income is the planned income
 * budget only; with none set the result says so rather than inferring income.
 */
export interface BudgetAllocationInput {
  incomePlanned: number;
  expensesPlanned: number;
  contributionsPlanned: number;
}

export interface BudgetAllocation {
  status: "within" | "over" | "no_income";
  expectedIncome: number;
  allocated: number;
  overBy: number;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function assessBudgetAllocation(input: BudgetAllocationInput): BudgetAllocation {
  const expectedIncome = round2(Math.max(0, finite(input.incomePlanned)));
  const allocated = round2(Math.max(0, finite(input.expensesPlanned)) + Math.max(0, finite(input.contributionsPlanned)));
  if (expectedIncome <= 0) return { status: "no_income", expectedIncome, allocated, overBy: 0 };
  const overBy = round2(allocated - expectedIncome);
  return overBy > 0
    ? { status: "over", expectedIncome, allocated, overBy }
    : { status: "within", expectedIncome, allocated, overBy: 0 };
}
