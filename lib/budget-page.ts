import type { CanonicalFinanceTransaction } from "./finance-domain";
import { titleCase } from "./format";
import type { FinanceWindow } from "./finance-query";
import type { SinkingFundPlan } from "./insights";

export type BudgetGroup =
  | "income"
  | "fixed"
  | "flexible"
  | "non_monthly";

export interface BudgetRecord {
  id: string;
  category: string;
  monthly_limit: number;
  group_name?: string;
  rollover_enabled?: boolean;
  sort_order?: number;
}

export interface BudgetPeriodRecord {
  budget_id: string;
  month: string;
  planned: number;
}

export interface BudgetLine {
  budgetId: string | null;
  category: string;
  label: string;
  basePlanned: number;
  planned: number;
  actual: number;
  remaining: number;
  budgeted: boolean;
  group: BudgetGroup;
  rolloverEnabled: boolean;
  rolloverCarry: number;
  sortOrder: number;
}

export interface BudgetSection {
  key: BudgetGroup;
  label: string;
  planned: number;
  actual: number;
  remaining: number;
  lines: BudgetLine[];
  unbudgetedCount: number;
}

export type BudgetHorizon = "monthly" | "yearly" | "decade";

/** Which figures the right rail's Summary/Income/Expenses tab shows. */
export type BudgetSummaryTab = "summary" | "income" | "expenses";

export interface BudgetPageData {
  month: string;
  horizon: "monthly";
  sections: BudgetSection[];
  totalIncome: { planned: number; actual: number };
  totalExpenses: { planned: number; actual: number; remaining: number };
  contributions: {
    goals: { name: string; planned: number; actual: number }[];
  };
  leftToBudget: number;
  sinkingFundsTotal: number;
}

export interface BudgetYearData {
  year: number;
  planned: number;
  actual: number;
  remaining: number;
  incomePlanned: number;
  incomeActual: number;
  months: BudgetPageData[];
}

export type BudgetViewData =
  | { horizon: "monthly"; month: BudgetPageData }
  | { horizon: "yearly"; year: number; months: BudgetPageData[] }
  | { horizon: "decade"; startYear: number; years: BudgetYearData[] };

export interface BudgetViewInput {
  month: string;
  horizon: BudgetHorizon;
  budgets: BudgetRecord[];
  periods?: BudgetPeriodRecord[];
  txns: CanonicalFinanceTransaction[];
  sinkingFunds?: SinkingFundPlan[];
  goalContributions?: {
    name: string;
    planned: number;
    actual: number;
  }[];
}

export interface BudgetSeedProposal {
  category: string;
  group_name: BudgetGroup;
  suggested_amount: number;
  rollover_enabled: boolean;
  sort_order: number;
  confidence: "high" | "medium" | "low";
  reason: string;
}

const MONTH_REGEX = /^(\d{4})-(0[1-9]|1[0-2])$/;
const GROUPS: BudgetGroup[] = [
  "income",
  "fixed",
  "flexible",
  "non_monthly",
];

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function proposalGroup(isIncome: boolean, fixedShare: number): BudgetGroup {
  if (isIncome) return "income";
  return fixedShare >= 0.5 ? "fixed" : "flexible";
}

function proposalConfidence(occurrences: number): "high" | "medium" | "low" {
  if (occurrences >= 3) return "high";
  if (occurrences >= 2) return "medium";
  return "low";
}

function proposalReason(group: BudgetGroup, isIncome: boolean): string {
  if (group === "fixed") return "Recurring charges make up most trailing spending";
  return isIncome
    ? "Based on three complete months of income"
    : "Based on three complete months of spending";
}

type ProposalTotals = {
  income: number;
  expense: number;
  recurringExpense: number;
  sourceIds: Set<string>;
};

function historyProposal(
  category: string,
  total: ProposalTotals,
  sortOrder: number,
): BudgetSeedProposal {
  const isIncome = total.income > total.expense;
  const fixedShare = total.expense > 0 ? total.recurringExpense / total.expense : 0;
  const group = proposalGroup(isIncome, fixedShare);
  const amount = isIncome ? total.income : total.expense;
  return {
    category,
    group_name: group,
    suggested_amount: round2(amount / 3),
    rollover_enabled: false,
    sort_order: sortOrder,
    confidence: proposalConfidence(total.sourceIds.size),
    reason: proposalReason(group, isIncome),
  };
}

function collectHistoryTotals(
  transactions: CanonicalFinanceTransaction[],
  recurringIds: Set<string>,
  existing: Set<string>,
): Map<string, ProposalTotals> {
  const totals = new Map<string, ProposalTotals>();
  for (const transaction of transactions) {
    if (transaction.flow === "transfer") continue;
    const category = (transaction.categoryKey || "Uncategorized").toLowerCase();
    if (existing.has(category)) continue;
    const current = totals.get(category) ?? {
      income: 0,
      expense: 0,
      recurringExpense: 0,
      sourceIds: new Set<string>(),
    };
    const amount = Math.abs(transaction.signedAmount);
    current.sourceIds.add(transaction.sourceTransactionId);
    if (transaction.flow === "income") current.income += amount;
    if (transaction.flow === "expense") {
      current.expense += amount;
      if (recurringIds.has(transaction.sourceTransactionId)) {
        current.recurringExpense += amount;
      }
    }
    totals.set(category, current);
  }
  return totals;
}

function appendSinkingFundProposals(
  proposals: BudgetSeedProposal[],
  funds: SinkingFundPlan[],
  existing: Set<string>,
): void {
  for (const fund of funds) {
    const category = fund.name.trim().toLowerCase();
    if (!category || existing.has(category)) continue;
    if (proposals.some((proposal) => proposal.category === category)) continue;
    proposals.push({
      category,
      group_name: "non_monthly",
      suggested_amount: round2(fund.monthlySetAside),
      rollover_enabled: true,
      sort_order: proposals.length,
      confidence: "high",
      reason: `Set aside monthly for ${fund.dueDate}`,
    });
  }
}

export function parseBudgetHorizon(value: unknown): BudgetHorizon {
  if (value === "yearly" || value === "decade") return value;
  return "monthly";
}

export function parseBudgetMonth(
  value: unknown,
  fallback: string,
): string {
  return typeof value === "string" && MONTH_REGEX.test(value)
    ? value
    : fallback;
}

function requireBudgetMonth(value: string): [number, number] {
  const match = MONTH_REGEX.exec(value);
  if (!match) throw new Error("invalid_budget_month");
  return [Number(match[1]), Number(match[2])];
}

function addMonths(month: string, delta: number): string {
  const [year, oneBasedMonth] = requireBudgetMonth(month);
  const total = year * 12 + oneBasedMonth - 1 + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function budgetWindow(
  anchorMonth: string,
  horizon: BudgetHorizon,
): FinanceWindow {
  const [year] = requireBudgetMonth(anchorMonth);
  if (horizon === "yearly") {
    return {
      start: `${year}-01-01`,
      endExclusive: `${year + 1}-01-01`,
    };
  }
  if (horizon === "decade") {
    const startYear = Math.floor(year / 10) * 10;
    return {
      start: `${startYear}-01-01`,
      endExclusive: `${startYear + 10}-01-01`,
    };
  }
  return {
    start: `${anchorMonth}-01`,
    endExclusive: `${addMonths(anchorMonth, 1)}-01`,
  };
}

export function getMonthEndDate(month: string): string {
  const [year, oneBasedMonth] = requireBudgetMonth(month);
  const lastDay = new Date(Date.UTC(year, oneBasedMonth, 0))
    .getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

function budgetGroup(value: string | undefined): BudgetGroup {
  return GROUPS.includes(value as BudgetGroup)
    ? (value as BudgetGroup)
    : "flexible";
}

function periodAmount(
  periods: BudgetPeriodRecord[],
  budgetId: string,
  month: string,
): number | undefined {
  const period = periods.find(
    (row) =>
      row.budget_id === budgetId && row.month.slice(0, 7) === month,
  );
  return period ? Number(period.planned) : undefined;
}

function actualsForMonth(
  txns: CanonicalFinanceTransaction[],
  month: string,
): {
  income: Map<string, number>;
  expenses: Map<string, number>;
} {
  const income = new Map<string, number>();
  const expenses = new Map<string, number>();
  for (const transaction of txns) {
    if (transaction.date.slice(0, 7) !== month) continue;
    const key = (transaction.categoryKey || "Uncategorized").toLowerCase();
    if (transaction.flow === "income") {
      income.set(
        key,
        round2((income.get(key) ?? 0) + Math.abs(transaction.signedAmount)),
      );
    }
    if (transaction.flow === "expense") {
      expenses.set(
        key,
        round2(
          (expenses.get(key) ?? 0) + Math.abs(transaction.signedAmount),
        ),
      );
    }
  }
  return { income, expenses };
}

function buildBudgetLines(
  budgets: BudgetRecord[],
  periods: BudgetPeriodRecord[],
  month: string,
  previousMonth: string,
  current: ReturnType<typeof actualsForMonth>,
  previous: ReturnType<typeof actualsForMonth>,
): Record<BudgetGroup, BudgetLine[]> {
  const processed = new Set<string>();
  const linesByGroup: Record<BudgetGroup, BudgetLine[]> = {
    income: [], fixed: [], flexible: [], non_monthly: [],
  };
  for (const budget of budgets) {
    const category = budget.category.toLowerCase();
    const group = budgetGroup(budget.group_name);
    const basePlanned = periodAmount(periods, budget.id, month) ?? Number(budget.monthly_limit);
    const previousPlanned = periodAmount(periods, budget.id, previousMonth) ?? Number(budget.monthly_limit);
    const rolloverCarry = budget.rollover_enabled && group !== "income"
      ? round2(previousPlanned - (previous.expenses.get(category) ?? 0))
      : 0;
    const planned = group === "income"
      ? round2(basePlanned)
      : Math.max(0, round2(basePlanned + rolloverCarry));
    const actual = group === "income"
      ? current.income.get(category) ?? 0
      : current.expenses.get(category) ?? 0;
    processed.add(category);
    linesByGroup[group].push({
      budgetId: budget.id,
      category: budget.category,
      label: titleCase(budget.category),
      basePlanned: round2(basePlanned),
      planned,
      actual: round2(actual),
      remaining: round2(group === "income" ? actual - planned : planned - actual),
      budgeted: true,
      group,
      rolloverEnabled: Boolean(budget.rollover_enabled),
      rolloverCarry,
      sortOrder: Number(budget.sort_order ?? 0),
    });
  }
  addUnbudgetedLines(linesByGroup, processed, current.expenses, "flexible");
  addUnbudgetedLines(linesByGroup, processed, current.income, "income");
  return linesByGroup;
}

function addUnbudgetedLines(
  linesByGroup: Record<BudgetGroup, BudgetLine[]>,
  processed: Set<string>,
  actuals: Map<string, number>,
  group: "income" | "flexible",
): void {
  for (const [category, actual] of actuals) {
    if (processed.has(category)) continue;
    const isIncome = group === "income";
    linesByGroup[group].push({
      budgetId: null,
      category,
      label: titleCase(category),
      basePlanned: 0,
      planned: 0,
      actual,
      remaining: round2(isIncome ? actual : -actual),
      budgeted: false,
      group,
      rolloverEnabled: false,
      rolloverCarry: 0,
      sortOrder: Number.MAX_SAFE_INTEGER,
    });
  }
}

function buildBudgetSections(
  linesByGroup: Record<BudgetGroup, BudgetLine[]>,
): BudgetSection[] {
  const labels: Record<BudgetGroup, string> = {
    income: "Income", fixed: "Fixed Expenses", flexible: "Flexible Expenses", non_monthly: "Non-Monthly Expenses",
  };
  return GROUPS.map((key): BudgetSection => {
    const lines = linesByGroup[key].toSorted(
      (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label),
    );
    const planned = round2(lines.reduce((total, line) => total + line.planned, 0));
    const actual = round2(lines.reduce((total, line) => total + line.actual, 0));
    return {
      key,
      label: labels[key],
      planned,
      actual,
      remaining: round2(key === "income" ? actual - planned : planned - actual),
      lines,
      unbudgetedCount: lines.filter((line) => !line.budgeted).length,
    };
  });
}

export function buildBudgetPage(input: {
  month: string;
  horizon?: BudgetHorizon;
  budgets: BudgetRecord[];
  periods?: BudgetPeriodRecord[];
  txns: CanonicalFinanceTransaction[];
  sinkingFunds?: SinkingFundPlan[];
  goalContributions?: {
    name: string;
    planned: number;
    actual: number;
  }[];
}): BudgetPageData {
  requireBudgetMonth(input.month);
  const periods = input.periods ?? [];
  const sinkingFunds = input.sinkingFunds ?? [];
  const goalContributions = input.goalContributions ?? [];
  const current = actualsForMonth(input.txns, input.month);
  const previousMonth = addMonths(input.month, -1);
  const previous = actualsForMonth(input.txns, previousMonth);
  const linesByGroup = buildBudgetLines(input.budgets, periods, input.month, previousMonth, current, previous);
  const sections = buildBudgetSections(linesByGroup);

  const income = sections[0];
  const expenses = sections.slice(1);
  const expensePlanned = round2(
    expenses.reduce((total, section) => total + section.planned, 0),
  );
  const expenseActual = round2(
    expenses.reduce((total, section) => total + section.actual, 0),
  );
  const contributionsPlanned = round2(
    goalContributions.reduce((total, goal) => total + goal.planned, 0),
  );

  return {
    month: input.month,
    horizon: "monthly",
    sections,
    totalIncome: {
      planned: income.planned,
      actual: income.actual,
    },
    totalExpenses: {
      planned: expensePlanned,
      actual: expenseActual,
      remaining: round2(expensePlanned - expenseActual),
    },
    contributions: { goals: goalContributions },
    leftToBudget: round2(
      income.planned - expensePlanned - contributionsPlanned,
    ),
    sinkingFundsTotal: round2(
      sinkingFunds.reduce(
        (total, fund) => total + fund.monthlySetAside,
        0,
      ),
    ),
  };
}

function yearData(input: BudgetViewInput, year: number): BudgetYearData {
  const months = Array.from({ length: 12 }, (_, index) =>
    buildBudgetPage({
      ...input,
      month: `${year}-${String(index + 1).padStart(2, "0")}`,
    }),
  );
  return {
    year,
    planned: round2(
      months.reduce(
        (total, month) => total + month.totalExpenses.planned,
        0,
      ),
    ),
    actual: round2(
      months.reduce(
        (total, month) => total + month.totalExpenses.actual,
        0,
      ),
    ),
    remaining: round2(
      months.reduce(
        (total, month) => total + month.totalExpenses.remaining,
        0,
      ),
    ),
    incomePlanned: round2(
      months.reduce(
        (total, month) => total + month.totalIncome.planned,
        0,
      ),
    ),
    incomeActual: round2(
      months.reduce(
        (total, month) => total + month.totalIncome.actual,
        0,
      ),
    ),
    months,
  };
}

export function buildBudgetView(input: BudgetViewInput): BudgetViewData {
  const [year] = requireBudgetMonth(input.month);
  if (input.horizon === "monthly") {
    return {
      horizon: "monthly",
      month: buildBudgetPage(input),
    };
  }
  if (input.horizon === "yearly") {
    return {
      horizon: "yearly",
      year,
      months: yearData(input, year).months,
    };
  }

  const startYear = Math.floor(year / 10) * 10;
  const endYear = startYear + 10;
  const yearsWithData = new Set<number>();
  for (const transaction of input.txns) {
    const transactionYear = Number(transaction.date.slice(0, 4));
    if (transactionYear >= startYear && transactionYear < endYear) {
      yearsWithData.add(transactionYear);
    }
  }
  for (const period of input.periods ?? []) {
    const periodYear = Number(period.month.slice(0, 4));
    if (periodYear >= startYear && periodYear < endYear) {
      yearsWithData.add(periodYear);
    }
  }
  return {
    horizon: "decade",
    startYear,
    years: [...yearsWithData]
      .sort((left, right) => left - right)
      .map((dataYear) => yearData(input, dataYear)),
  };
}

export function proposeBudgetFromHistory(input: {
  txnsLast3Months: CanonicalFinanceTransaction[];
  recurringTransactionIds?: Set<string>;
  sinkingFunds?: SinkingFundPlan[];
  existingCategories?: Set<string>;
}): BudgetSeedProposal[] {
  const recurringIds = input.recurringTransactionIds ?? new Set<string>();
  const existing = new Set(
    [...(input.existingCategories ?? new Set<string>())].map((category) =>
      category.toLowerCase(),
    ),
  );
  const totals = collectHistoryTotals(
    input.txnsLast3Months,
    recurringIds,
    existing,
  );

  const proposals: BudgetSeedProposal[] = [];
  for (const [category, total] of totals) {
    proposals.push(historyProposal(category, total, proposals.length));
  }

  appendSinkingFundProposals(proposals, input.sinkingFunds ?? [], existing);

  return proposals
    .filter((proposal) => proposal.suggested_amount > 0)
    .map((proposal, index) => ({ ...proposal, sort_order: index }));
}
